import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-app.js";
import { getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, getDocs, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";

// 🛠️ CONFIG: REPLACE THESE WITH YOUR FIREBASE KEYS
const firebaseConfig = {
    apiKey: "AIzaSyCPQ0cgeH1AQgIECnNQKN64euFSPxpKhhY",
    authDomain: "chatrix-app-6c1e3.firebaseapp.com",
    projectId: "chatrix-app-6c1e3",
    storageBucket: "chatrix-app-6c1e3.firebasestorage.app",
    messagingSenderId: "399541104009",
    appId: "1:399541104009:web:25a6b7ced53e84f27a4558"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;
let roomId = null;
let unsubRoom = null;
let unsubMessages = null;
let unsubQueue = null;

// UI Selection
const landing = document.getElementById('landing');
const chatView = document.getElementById('chat-view');
const messagesList = document.getElementById('messages-list');
const loader = document.getElementById('searching-loader');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');

onAuthStateChanged(auth, (user) => { 
    if (user) currentUser = user; 
});

// START CHAT 🚀
window.handleStart = async () => {
    landing.classList.add('hidden');
    chatView.classList.remove('hidden');
    chatView.classList.add('flex');
    loader.classList.remove('hidden');
    messagesList.innerHTML = '';
    
    if (!currentUser) {
        const res = await signInAnonymously(auth);
        currentUser = res.user;
    }
    findPartner();
};

// MATCHMAKING LOGIC 🔍
const findPartner = async () => {
    const userId = currentUser.uid;
    const myQueueRef = doc(db, 'queue', userId);
    
    // 1. Enter Queue with a local timestamp for instant matching
    await setDoc(myQueueRef, { 
        uid: userId, 
        status: 'waiting', 
        roomId: null, 
        timestamp: Date.now() 
    });

    console.log("Searching for partner...");

    // 2. Listen for a match (someone else might find us)
    unsubQueue = onSnapshot(myQueueRef, (snapshot) => {
        const data = snapshot.data();
        if (data && data.status === 'matched' && data.roomId) {
            console.log("Matched as receiver!");
            startChat(data.roomId);
            if (unsubQueue) unsubQueue();
        }
    });

    // 3. Try to find someone else waiting (Simplified to avoid Index requirements)
    const tryMatch = async () => {
        if (roomId) return;

        try {
            // Simple query: Just find anyone waiting. 
            // We handle the "not me" filter in the code below to avoid needing a complex Firebase Index.
            const q = query(
                collection(db, 'queue'), 
                where('status', '==', 'waiting'),
                limit(10) 
            );

            const querySnapshot = await getDocs(q);
            
            for (const docSnap of querySnapshot.docs) {
                const partnerData = docSnap.data();
                
                if (partnerData.uid !== userId && partnerData.status === 'waiting') {
                    const newRoomId = [userId, partnerData.uid].sort().join('_');
                    
                    console.log("Found partner! Creating room:", newRoomId);

                    // Create the room
                    await setDoc(doc(db, 'rooms', newRoomId), { 
                        users: [userId, partnerData.uid], 
                        active: true, 
                        typing: {} 
                    });

                    // Match both
                    await updateDoc(doc(db, 'queue', partnerData.uid), { status: 'matched', roomId: newRoomId });
                    await updateDoc(myQueueRef, { status: 'matched', roomId: newRoomId });
                    return; // Successfully matched!
                }
            }
            
            // No one found or only found self, try again in 3 seconds
            setTimeout(tryMatch, 3000);

        } catch (error) {
            console.error("Matching Error:", error);
            // Even on error, try again
            setTimeout(tryMatch, 3000);
        }
    };

    tryMatch();
};

// IN-CHAT LOGIC 💬
const startChat = (id) => {
    if (unsubQueue) unsubQueue();
    roomId = id;
    loader.classList.add('hidden');
    messageInput.disabled = false;
    messageInput.placeholder = "Share your word...";
    
    // Clear list and add system message
    messagesList.innerHTML = '';
    addSystemMessage('Matched on Chatrix! Say Hi.');

    // We listen to ALL messages in the room and sort them in JS to avoid index requirements
    const msgsRef = collection(db, 'rooms', id, 'messages');
    unsubMessages = onSnapshot(msgsRef, (snapshot) => {
        // Collect all messages, sort by local time
        const docs = snapshot.docs.map(d => ({id: d.id, ...d.data()}));
        docs.sort((a, b) => (a.time || 0) - (b.time || 0));

        messagesList.innerHTML = '';
        addSystemMessage('Matched on Chatrix! Say Hi.');
        
        docs.forEach(data => {
            const time = new Date(data.time || Date.now());
            addMessage(data.text, data.senderId === currentUser.uid ? 'me' : 'stranger', time);
        });
    });

    unsubRoom = onSnapshot(doc(db, 'rooms', id), (snapshot) => {
        const data = snapshot.data();
        if (data && !data.active) {
            addSystemMessage('Stranger has left the conversation.');
            handleStop();
        }
    });
};

// ACTIONS 🛑
window.handleStop = async () => {
    if (roomId) {
        const rId = roomId;
        roomId = null; // Prevent loops
        await updateDoc(doc(db, 'rooms', rId), { active: false }).catch(()=>{});
    }
    if (unsubRoom) unsubRoom();
    if (unsubMessages) unsubMessages();
    if (unsubQueue) unsubQueue();
    if (currentUser) await deleteDoc(doc(db, 'queue', currentUser.uid)).catch(()=>{});
    
    landing.classList.remove('hidden');
    chatView.classList.add('hidden');
    chatView.classList.remove('flex');
    messageInput.disabled = true;
    messageInput.value = '';
};

window.handleNext = async () => {
    await handleStop();
    handleStart();
};

chatForm.onsubmit = async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !roomId) return;
    
    const currentRoomId = roomId;
    messageInput.value = '';
    
    await addDoc(collection(db, 'rooms', currentRoomId, 'messages'), { 
        text, 
        senderId: currentUser.uid, 
        time: Date.now() // Use instant timestamp
    });
};

// UI HELPERS
const addMessage = (text, sender, date) => {
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = `flex flex-col ${sender === 'me' ? 'items-end' : 'items-start'}`;
    div.innerHTML = `
        <div class="${sender === 'me' ? 'bg-gradient-to-br from-[#FFD700] to-[#DAA520] text-white rounded-tr-none border-b-6 border-[#B8860B]' : 'bg-white text-[#2C2C2C] rounded-tl-none border-b-6 border-gray-100'} max-w-[85%] px-8 py-5 rounded-3xl text-xl font-medium shadow-lg">
            ${text}
        </div>
        <span class="text-[11px] text-[#2C2C2C]/40 mt-3 uppercase font-black tracking-widest px-3">${sender === 'me' ? 'You' : 'Stranger'} • ${time}</span>
    `;
    messagesList.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth' });
};

const addSystemMessage = (text) => {
    const div = document.createElement('div');
    div.className = "flex justify-center my-10";
    div.innerHTML = `<span class="bg-[#FFF8DC] text-[#DAA520] text-[11px] font-black px-8 py-3 rounded-full uppercase tracking-[0.4em] border border-[#FFD700]"> ${text} </span>`;
    messagesList.appendChild(div);
};
