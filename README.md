# Multi-Room Collaborative Whiteboard

A real-time collaborative drawing application with room-based functionality, built with Node.js, Express, WebSockets, and Firebase.

## Features

- 🎨 Real-time collaborative drawing
- 🏠 Multi-room system
- 🔄 Undo/Redo functionality
- 🎯 Multiple drawing tools (pencil, shapes, text, etc.)
- 👥 User presence indicators
- 💾 Persistent drawing history
- 📱 Responsive design

## Tech Stack

- **Backend**: Node.js, Express, WebSocket
- **Frontend**: HTML5 Canvas, JavaScript, CSS3
- **Database**: Firebase Firestore
- **Authentication**: Firebase Anonymous Auth

## Local Development

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd test-setup
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Firebase**
   - Update Firebase configuration in `public/whiteboard.js`
   - Ensure your Firebase project has Firestore enabled

4. **Start the server**
   ```bash
   npm start
   ```

5. **Open in browser**
   - Navigate to `http://localhost:3000`

## Deployment

### Option 1: Render (Recommended)

1. **Create a Render account** at [render.com](https://render.com)

2. **Connect your GitHub repository**

3. **Create a new Web Service**
   - **Name**: `your-whiteboard-app`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Port**: `3000`

4. **Add Environment Variables** (if needed):
   - `NODE_ENV=production`

5. **Deploy**

## Environment Variables

The application uses Firebase configuration. Make sure to update the Firebase config in `public/whiteboard.js` with your own project details:

```javascript
const firebaseConfig = {
    apiKey: "your-api-key",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "your-sender-id",
    appId: "your-app-id"
};
```

## Project Structure

```
test-setup/
├── public/                 # Static files
│   ├── index.html         # Home page
│   ├── whiteboard.html    # Whiteboard page
│   ├── whiteboard.js      # Main whiteboard logic
│   ├── whiteboard-style.css
│   ├── script.js          # Home page logic
│   └── style.css          # Home page styles
├── server.js              # Express server
├── rooms.json             # Room data storage
├── package.json           # Dependencies
└── README.md             # This file
```

## API Endpoints

- `GET /` - Home page
- `POST /api/rooms` - Create a new room
- `GET /api/rooms/:id` - Get room information
- `GET /whiteboard/:roomId` - Join a room (with user parameter)

## WebSocket Events

- `join_room` - Join a room
- `drawing_data` - Send drawing data
- `user_joined` - User joined notification
- `user_left` - User left notification

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details 


Render deployed LINK is attached below :
https://multiuser-whiteboard-2.onrender.com
