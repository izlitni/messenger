const CONFIG = { broker: "wss://broker.emqx.io:8084/mqtt", topic: "msg_fixed_v5" };
let client, user;
let myRooms = JSON.parse(localStorage.getItem('rooms')) || [];
// Initialize with a default global room so Explore isn't empty
let publicRooms = {
    'global_lounge': { id: 'global_lounge', name: 'Global Lounge', isPub: true }
};
let activeRoom = null;
let mediaRecorder, audioChunks = [], isRecording = false;

// Check if user is already logged in
if(localStorage.getItem('user')) {
    user = JSON.parse(localStorage.getItem('user'));
    // Wait for HTML to be ready before running init
    document.addEventListener('DOMContentLoaded', init);
}

function handleLogin() {
    const name = document.getElementById('username-in').value.trim();
    if(!name) return;
    user = { id: 'u_'+Math.random().toString(36).substr(2,6), name };
    localStorage.setItem('user', JSON.stringify(user));
    init();
}

function init() {
    document.getElementById('login-layer').classList.add('hidden');
    document.getElementById('main-layer').classList.remove('hidden');
    setupProfile();
    renderChats();
    renderExplore(); // Render default public rooms immediately
    connect();
}

// ENTER KEY LISTENER
document.getElementById('msg-input').addEventListener('keypress', function(e) {
    if(e.key === 'Enter') sendText();
});

function setupProfile() {
    document.getElementById('profile-name').innerText = user.name;
    const av = document.getElementById('profile-avatar');
    av.innerText = user.name[0];
    av.style.background = generateGradient(user.name);
}

function generateGradient(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `linear-gradient(135deg, hsl(${hash % 360}, 70%, 50%), hsl(${(hash+40) % 360}, 70%, 50%))`;
}

function connect() {
    client = mqtt.connect(CONFIG.broker);
    client.on('connect', () => {
        document.getElementById('conn-status').innerText = "Online";
        document.getElementById('conn-status').classList.remove('offline');
        
        // Subscribe to global public list
        client.subscribe(`${CONFIG.topic}/pub`);
        
        // Subscribe to my specific rooms
        myRooms.forEach(r => client.subscribe(`${CONFIG.topic}/room/${r.id}`));
        
        // Publish existence of my public rooms occasionally
        setInterval(() => myRooms.filter(r=>r.isPub).forEach(publishPub), 10000);
    });

    client.on('message', (t, m) => {
        const d = JSON.parse(m.toString());
        if(t.includes('/pub')) { 
            publicRooms[d.id] = d; 
            renderExplore(); 
        }
        else { 
            handleMsg(t.split('/').pop(), d); 
        }
    });
}

function publishPub(r) {
    client.publish(`${CONFIG.topic}/pub`, JSON.stringify({id: r.id, name: r.name}));
}

function createRoom() {
    const name = document.getElementById('new-room-name').value;
    const isPub = document.getElementById('is-public-check').checked;
    if(!name) return;
    const r = { id: Math.random().toString(36).substr(2,8), name, isPub, msgs: [], time: Date.now() };
    saveRoom(r);
    if(isPub) publishPub(r);
    closeModal();
    openChat(r.id);
}

function joinRoom() {
    const id = document.getElementById('join-id').value;
    if(!id) return;
    saveRoom({ id, name: "Joined Chat", isPub: false, msgs: [], time: Date.now() });
    closeModal();
    openChat(id);
}

function saveRoom(r) {
    const i = myRooms.findIndex(mr => mr.id === r.id);
    if(i < 0) { 
        myRooms.push(r); 
        if(client) client.subscribe(`${CONFIG.topic}/room/${r.id}`); 
    }
    else {
        // preserve messages if updating room details
        if(!r.msgs) r.msgs = myRooms[i].msgs;
        myRooms[i] = r;
    }
    localStorage.setItem('rooms', JSON.stringify(myRooms));
    renderChats();
}

function openChat(rid) {
    activeRoom = myRooms.find(r => r.id === rid);
    if(!activeRoom) return;
    document.getElementById('chat-room-name').innerText = activeRoom.name;
    const feed = document.getElementById('chat-feed');
    feed.innerHTML = '';
    activeRoom.msgs.forEach(renderMsg);
    document.getElementById('chat-layer').classList.add('open');
    setTimeout(() => feed.scrollTop = feed.scrollHeight, 50);
}

function closeChat() {
    document.getElementById('chat-layer').classList.remove('open');
    activeRoom = null;
    renderChats();
}

function copyRoomId() {
    if(!activeRoom) return;
    navigator.clipboard.writeText(activeRoom.id);
    alert('Copied Room ID: ' + activeRoom.id);
}

// VOICE LOGIC
async function recordVoice() {
    const btn = document.getElementById('mic-btn');
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.start();
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = () => {
                const blob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onload = () => {
                    const msg = { from: user.id, name: user.name, txt: reader.result, type: 'audio' };
                    processMsg(activeRoom.id, msg);
                    client.publish(`${CONFIG.topic}/room/${activeRoom.id}`, JSON.stringify(msg));
                };
                reader.readAsDataURL(blob);
                audioChunks = [];
                stream.getTracks().forEach(t => t.stop());
            };
            isRecording = true;
            btn.classList.add('recording');
        } catch(e) { alert('Mic access denied'); }
    } else {
        mediaRecorder.stop();
        isRecording = false;
        btn.classList.remove('recording');
    }
}

function sendText() {
    const txt = document.getElementById('msg-input').value.trim();
    if(!txt || !activeRoom) return;
    const msg = { from: user.id, name: user.name, txt, type: 'text' };
    processMsg(activeRoom.id, msg);
    client.publish(`${CONFIG.topic}/room/${activeRoom.id}`, JSON.stringify(msg));
    document.getElementById('msg-input').value = '';
}

function sendImage(inp) {
    if(!inp.files[0] || !activeRoom) return;
    const reader = new FileReader();
    reader.onload = e => {
        const msg = { from: user.id, name: user.name, txt: e.target.result, type: 'img' };
        processMsg(activeRoom.id, msg);
        client.publish(`${CONFIG.topic}/room/${activeRoom.id}`, JSON.stringify(msg));
    };
    reader.readAsDataURL(inp.files[0]);
}

function handleMsg(rid, msg) {
    if(msg.from !== user.id) processMsg(rid, msg);
}

function processMsg(rid, msg) {
    const r = myRooms.find(rm => rm.id === rid);
    if(r) {
        r.msgs.push(msg); r.time = Date.now();
        saveRoom(r);
        if(activeRoom && activeRoom.id === rid) {
            renderMsg(msg);
            const feed = document.getElementById('chat-feed');
            feed.scrollTop = feed.scrollHeight;
        }
    }
}

function renderMsg(msg) {
    const isMe = msg.from === user.id;
    const d = document.createElement('div');
    d.className = `msg-row ${isMe ? 'sent' : 'received'}`;
    let c = msg.txt;
    if(msg.type === 'img') c = `<img src="${msg.txt}" style="max-width:100%; border-radius:12px;">`;
    if(msg.type === 'audio') c = `<audio controls src="${msg.txt}" style="max-width:200px;"></audio>`;
    d.innerHTML = `${!isMe ? `<div class="msg-meta">${msg.name}</div>` : ''}<div class="bubble">${c}</div>`;
    document.getElementById('chat-feed').appendChild(d);
}

function renderChats() {
    const l = document.getElementById('chats-list');
    l.innerHTML = '';
    myRooms.sort((a,b) => b.time - a.time).forEach(r => {
        const last = r.msgs[r.msgs.length-1];
        let prevTxt = 'New chat';
        if (last) {
            if (last.type === 'img') prevTxt = '📷 Photo';
            else if (last.type === 'audio') prevTxt = '🎤 Voice Message';
            else prevTxt = last.txt;
        }
        const div = document.createElement('div');
        div.className = 'list-item';
        div.onclick = () => openChat(r.id);
        div.innerHTML = `
            <div class="avatar" style="background:${generateGradient(r.name)}">${r.name[0]}</div>
            <div class="list-info">
                <div class="list-title">${r.name}</div>
                <div class="list-sub">${prevTxt}</div>
            </div>`;
        l.appendChild(div);
    });
    // Toggle Empty State visibility
    document.getElementById('empty-state').style.display = myRooms.length ? 'none' : 'block';
}

function renderExplore() {
    const l = document.getElementById('explore-list');
    l.innerHTML = '';
    Object.values(publicRooms).forEach(r => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.onclick = () => {
            if(!myRooms.find(mr=>mr.id===r.id)) saveRoom({...r, msgs:[], time:Date.now(), isPub:true});
            openChat(r.id); switchTab('chats', document.querySelector('.nav-btn'));
        };
        div.innerHTML = `<div class="avatar" style="background:#E0F2FF; color:#007AFF;">#</div>
            <div class="list-info"><div class="list-title">${r.name}</div><div class="list-sub" style="color:#007AFF;">Tap to Join</div></div>`;
        l.appendChild(div);
    });
}

function switchTab(id, btn) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${id}`).classList.add('active');
    const t = { 'chats':'Chats', 'explore':'Explore', 'profile':'Settings' };
    document.getElementById('header-title').innerText = t[id];
    document.getElementById('fab-btn').style.display = id==='profile'?'none':'flex';
}

function openModal() { document.getElementById('create-modal').style.display = 'flex'; }
function closeModal() { document.getElementById('create-modal').style.display = 'none'; }
function copyMyId() { navigator.clipboard.writeText(user.id); alert("Copied ID"); }
function clearHistory() { if(confirm('Clear all?')) { myRooms=[]; localStorage.setItem('rooms','[]'); location.reload(); } }
function logout() { if(confirm('Logout?')) { localStorage.clear(); location.reload(); } }
