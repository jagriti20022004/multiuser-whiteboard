// Global variables
let currentRoom = null;
let currentUser = null;
let ws = null;
let wsConnected = false;

// DOM elements
const createRoomForm = document.getElementById('createRoomForm');
const joinRoomForm = document.getElementById('joinRoomForm');
const roomInfo = document.getElementById('roomInfo');
const statusMessage = document.getElementById('statusMessage');
const copyRoomIdBtn = document.getElementById('copyRoomId');
const leaveRoomBtn = document.getElementById('leaveRoom');

// Initialize WebSocket connection
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        wsConnected = true;
        showStatus('Connected to server', 'success');
        
        // If we have pending room join, send it now
        if (currentRoom && currentUser) {
            sendJoinRoomMessage();
        }
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        wsConnected = false;
        showStatus('Connection lost. Please refresh the page.', 'error');
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        wsConnected = false;
        showStatus('Connection error', 'error');
    };
}

// Send join room message
function sendJoinRoomMessage() {
    if (ws && wsConnected && currentRoom && currentUser) {
        ws.send(JSON.stringify({
            type: 'join_room',
            roomId: currentRoom,
            userName: currentUser
        }));
    }
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
    console.log('WebSocket message received:', data);
    
    switch (data.type) {
        case 'room_joined':
            currentRoom = data.room.id;
            currentUser = data.room.participants[data.room.participants.length - 1];
            displayRoomInfo(data.room);
            showStatus(`Joined room: ${data.room.name}`, 'success');
            
            // Redirect to whiteboard immediately
            redirectToWhiteboard(data.room.id, currentUser);
            break;
            
        case 'user_joined':
            updateParticipants(data.participants);
            showStatus(`${data.userName} joined the room`, 'info');
            break;
            
        case 'user_left':
            updateParticipants(data.participants);
            showStatus(`${data.userName} left the room`, 'info');
            break;
            
        case 'drawing_update':
            // Handle drawing updates (will be implemented later)
            console.log('Drawing update received:', data);
            break;
            
        case 'canvas_cleared':
            showStatus(`${data.user} cleared the canvas`, 'info');
            break;
    }
}

// Redirect to whiteboard
function redirectToWhiteboard(roomId, userName) {
    console.log('Redirecting to whiteboard:', roomId, userName);
    const whiteboardUrl = `/whiteboard/${roomId}?user=${encodeURIComponent(userName)}`;
    console.log('Redirect URL:', whiteboardUrl);
    window.location.href = whiteboardUrl;
}

// Create room
createRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('Create room form submitted');
    
    const formData = new FormData(createRoomForm);
    const roomData = {
        roomName: formData.get('roomName'),
        creatorName: formData.get('creatorName'),
        passcode: formData.get('passcode')
    };
    
    console.log('Room data:', roomData);
    
    try {
        showStatus('Creating room...', 'info');
        
        const response = await fetch('/api/rooms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(roomData)
        });
        
        console.log('Response status:', response.status);
        const result = await response.json();
        console.log('API response:', result);
        
        if (result.success) {
            currentRoom = result.roomId;
            currentUser = roomData.creatorName;
            
            showStatus('Room created successfully! Redirecting...', 'success');
            createRoomForm.reset();
            
            // Direct redirect with a small delay to ensure room is saved
            setTimeout(() => {
                console.log('Redirecting to whiteboard with room:', result.roomId, roomData.creatorName);
                const whiteboardUrl = `/whiteboard/${result.roomId}?user=${encodeURIComponent(roomData.creatorName)}`;
                console.log('Redirect URL:', whiteboardUrl);
                window.location.href = whiteboardUrl;
            }, 1000);
        } else {
            showStatus(result.error || 'Failed to create room', 'error');
        }
    } catch (error) {
        console.error('Error creating room:', error);
        showStatus('Error creating room. Please try again.', 'error');
    }
});

// Join room
joinRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log('Join room form submitted');
    
    const formData = new FormData(joinRoomForm);
    const joinData = {
        roomId: formData.get('roomId'),
        participantName: formData.get('participantName'),
        joinPasscode: formData.get('joinPasscode')
    };
    
    console.log('Join data:', joinData);
    
    try {
        showStatus('Joining room...', 'info');
        
        const response = await fetch('/api/rooms/join', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                roomId: joinData.roomId,
                passcode: joinData.joinPasscode,
                participantName: joinData.participantName
            })
        });
        
        const result = await response.json();
        console.log('Join API response:', result);
        
        if (result.success) {
            currentRoom = result.room.id;
            currentUser = joinData.participantName;
            
            showStatus('Joined room successfully! Redirecting...', 'success');
            joinRoomForm.reset();
            
            // Direct redirect with a small delay to ensure room is updated
            setTimeout(() => {
                console.log('Redirecting to whiteboard with room:', result.room.id, joinData.participantName);
                const whiteboardUrl = `/whiteboard/${result.room.id}?user=${encodeURIComponent(joinData.participantName)}`;
                console.log('Redirect URL:', whiteboardUrl);
                window.location.href = whiteboardUrl;
            }, 1000);
        } else {
            showStatus(result.error || 'Failed to join room', 'error');
        }
    } catch (error) {
        console.error('Error joining room:', error);
        showStatus('Error joining room. Please try again.', 'error');
    }
});

// Display room information
function displayRoomInfo(room) {
    document.getElementById('displayRoomName').textContent = room.name;
    document.getElementById('displayRoomId').textContent = room.id;
    updateParticipants(room.participants);
    roomInfo.style.display = 'block';
    
    // Hide forms
    document.getElementById('createRoomSection').style.display = 'none';
    document.getElementById('joinRoomSection').style.display = 'none';
}

// Update participants list
function updateParticipants(participants) {
    const participantsText = participants.join(', ');
    document.getElementById('displayParticipants').textContent = participantsText;
}

// Copy room ID to clipboard
copyRoomIdBtn.addEventListener('click', async () => {
    const roomId = document.getElementById('displayRoomId').textContent;
    
    try {
        await navigator.clipboard.writeText(roomId);
        copyRoomIdBtn.textContent = 'Copied!';
        copyRoomIdBtn.classList.add('btn-copied');
        
        setTimeout(() => {
            copyRoomIdBtn.textContent = 'Copy Room ID';
            copyRoomIdBtn.classList.remove('btn-copied');
        }, 2000);
        
        showStatus('Room ID copied to clipboard!', 'success');
    } catch (error) {
        console.error('Failed to copy room ID:', error);
        showStatus('Failed to copy room ID', 'error');
    }
});

// Leave room
leaveRoomBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to leave this room?')) {
        // Close WebSocket connection
        if (ws) {
            ws.close();
        }
        
        // Reset state
        currentRoom = null;
        currentUser = null;
        wsConnected = false;
        
        // Show forms again
        document.getElementById('createRoomSection').style.display = 'block';
        document.getElementById('joinRoomSection').style.display = 'block';
        roomInfo.style.display = 'none';
        
        showStatus('Left the room', 'info');
        
        // Reinitialize WebSocket
        initWebSocket();
    }
});

// Show status message
function showStatus(message, type = 'info') {
    console.log('Status:', message, type);
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        statusMessage.style.display = 'none';
    }, 5000);
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing application...');
    
    // Test if forms exist
    console.log('Create room form:', createRoomForm);
    console.log('Join room form:', joinRoomForm);
    
    if (!createRoomForm) {
        console.error('Create room form not found!');
    }
    
    initWebSocket();
    
    // Add some helpful tips
    showStatus('Welcome! Create a room or join an existing one to start collaborating.', 'info');
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (ws) {
        ws.close();
    }
}); 