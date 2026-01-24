const CONFIG = { broker: "wss://broker.emqx.io:8084/mqtt", topic: "msg_fixed_v5" };
let client;
let user = JSON.parse(localStorage.getItem('user')) || null;
let myRooms = JSON.parse(localStorage.getItem('rooms')) || [];
let publicRooms = {
    'global_lounge': { id: 'global_lounge', name: 'Global Lounge', isPub: true },
    'tech_talk': { id: 'tech_talk', name: 'Tech Talk', isPub: true }
};
let activeRoom = null;
let mediaRecorder, audioChunks = [], isRecording = false;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    if (user) {
        init();
    } else {
        document.getElementById('login-layer').classList.remove('hidden');
    }
});

function handleLogin() {
    const nameInput = document.getElementById('username-in');
    const name = nameInput.value.trim();
    if (!name) return;
    
    user = { id: 'u_' + Math.random().toString(36).substr(2, 6), name: name };
    localStorage.setItem('user', JSON.stringify(user));
    init();
}

function init() {
    // Hide Login
    document.getElementById('login-layer').classList.add('hidden');
    document.getElementById('main-layer').classList.remove('hidden');

    // FORCE DEFAULT DATA IF MISSING
    // Check if the 'welcome_bot' is already in the list
    const botExists = myRooms.some(r => r.id === 'welcome_bot');
    
    if (!botExists) {
        myRooms.push({
            id: 'welcome_bot',
            name: 'Messenger Bot',
            msgs: [{ from: 'bot', name: 'Bot', txt: 'Welcome! This is a local chat bot. Tap + to create new rooms.', type: 'text' }],
            time: Date.now(),
            isPub: false
        });
        localStorage.setItem('rooms', JSON.stringify(myRooms));
    }

    // Initialize UI
    setupProfile();
    renderChats();
    renderExplore();
    
    // Connect to MQTT
    connect();
}

// --- UI RENDERERS ---

function setupProfile() {
    if (!user) return;
    document.getElementById('profile-name').innerText = user.name;
    const av = document.getElementById('profile-avatar');
    av.innerText = user.name[0];
    av.style.background = generateGradient(user.name);
}

function renderChats() {
    const list = document.getElementById('chats-list');
    const emptyState = document.getElementById('empty-state');
    list.innerHTML = '';
    
    if (myRooms.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    
    // Sort: Newest first
    myRooms.sort((a, b) => b.time - a.time).forEach(r => {
        const last = r.msgs[r.msgs.length - 1];
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
        list.appendChild(div);
    });
}

function renderExplore() {
    const list = document.getElementById('explore-list');
    list.innerHTML = ''; 

    Object.values(publicRooms).forEach(r => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.onclick = () => {
            if (!myRooms.find(mr => mr.id === r.id)) {
                saveRoom({ ...r, msgs: [], time: Date.now(), isPub: true });
            }
            openChat(r.id);
            switchTab('chats', document.querySelector('.nav-btn'));
        };
        div.innerHTML = `
            <div class="avatar" style="background:#E0F2FF; color:#007AFF;">#</div>
            <div class="list-info">
                <div class="list-title">${r.name}</div>
                <div class="list-sub" style="color:#007AFF;">Tap to Join</div>
            </div>`;
        list.appendChild(div);
    });
}

// --- NETWORK ---

function connect() {
    client = mqtt.connect(CONFIG.broker);
    client.on('connect', () => {
        document.getElementById('conn-status').innerText = "Online";
        document.getElementById('conn-status').classList.remove('offline');
        client.subscribe(`${CONFIG.topic}/pub`);
        myRooms.forEach(r => client.subscribe(`${CONFIG.topic}/room/${r.id}`));
        setInterval(() => myRooms.filter(r => r.isPub).forEach(publishPub), 5000);
    });

    client.on('message', (t, m) => {
        const d = JSON.parse(m.toString());
        if (t.includes('/pub')) {
            if (!publicRooms[d.id]) {
                publicRooms[d.id] = d;
                renderExplore();
            }
        } else {
            handleMsg(t.split('/').pop(), d);
        }
    });
}

function publishPub(r) {
    if(client && client.connected) {
        client.publish(`${CONFIG.topic}/pub`, JSON.stringify({ id: r.id, name: r.name }));
    }
}

// --- CHAT LOGIC ---

function openChat(rid) {
    activeRoom = myRooms.find(r => r.id === rid);
    if (!activeRoom) return;

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

function saveRoom(r) {
    const i = myRooms.findIndex(mr => mr.id === r.id);
    if (i < 0) {
        myRooms.push(r);
        if (client) client.subscribe(`${CONFIG.topic}/room/${r.id}`);
    } else {
        myRooms[i] = r;
    }
    localStorage.setItem('rooms', JSON.stringify(myRooms));
    renderChats();
}

function handleMsg(rid, msg) {
    if (msg.from !== user.id) processMsg(rid, msg);
}

function processMsg(rid, msg) {
    const r = myRooms.find(rm => rm.id === rid);
    if (r) {
        r.msgs.push(msg);
        r.time = Date.now();
        saveRoom(r);
        if (activeRoom && activeRoom.id === rid) {
            renderMsg(msg);
            const feed = document.getElementById('chat-feed');
            feed.scrollTop = feed.scrollHeight;
        }
    }
}

// --- ACTIONS ---

document.getElementById('msg-input').addEventListener('keypress', function(e) {
    if(e.key === 'Enter') sendText();
});

function sendText() {
    const txt = document.getElementById('msg-input').value.trim();
    if (!txt || !activeRoom) return;
    const msg = { from: user.id, name: user.name, txt, type: 'text' };
    processMsg(activeRoom.id, msg);
    if(client) client.publish(`${CONFIG.topic}/room/${activeRoom.id}`, JSON.stringify(msg));
    document.getElementById('msg-input').value = '';
}

function sendImage(inp) {
    if (!inp.files[0] || !activeRoom) return;
    const reader = new FileReader();
    reader.onload = e => {
        const msg = { from: user.id, name: user.name, txt: e.target.result, type: 'img' };
        processMsg(activeRoom.id, msg);
        if(client) client.publish(`${CONFIG.topic}/room/${activeRoom.id}`, JSON.stringify(msg));
    };
    reader.readAsDataURL(inp.files[0]);
}

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
                    if(client) client.publish(`${CONFIG.topic}/room/${activeRoom.id}`, JSON.stringify(msg));
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

// --- HELPERS ---

function renderMsg(msg) {
    const isMe = msg.from === user.id;
    const d = document.createElement('div');
    d.className = `msg-row ${isMe ? 'sent' : 'received'}`;
    let c = msg.txt;
    if (msg.type === 'img') c = `<img src="${msg.txt}" style="max-width:100%; border-radius:12px;">`;
    if (msg.type === 'audio') c = `<audio controls src="${msg.txt}"></audio>`;
    d.innerHTML = `${!isMe ? `<div class="msg-meta">${msg.name}</div>` : ''}<div class="bubble">${c}</div>`;
    document.getElementById('chat-feed').appendChild(d);
}

function generateGradient(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `linear-gradient(135deg, hsl(${hash % 360}, 70%, 50%), hsl(${(hash + 40) % 360}, 70%, 50%))`;
}

function switchTab(id, btn) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${id}`).classList.add('active');
    const titles = { 'chats': 'Chats', 'explore': 'Explore', 'profile': 'Settings' };
    document.getElementById('header-title').innerText = titles[id];
    document.getElementById('fab-btn').style.display = id === 'profile' ? 'none' : 'flex';
}

function openModal() { document.getElementById('create-modal').style.display = 'flex'; }
function closeModal() { document.getElementById('create-modal').style.display = 'none'; }
function copyMyId() { navigator.clipboard.writeText(user.id); alert("Copied ID"); }
function copyRoomId() { if(activeRoom) { navigator.clipboard.writeText(activeRoom.id); alert("Copied Room ID"); } }
function clearHistory() { if (confirm('Clear all?')) { myRooms = []; localStorage.setItem('rooms', '[]'); location.reload(); } }
function logout() { if (confirm('Log out?')) { localStorage.clear(); location.reload(); } }
