# In Chat Backend
1. `npm install`
2. `JWT_SECRET=लंबा-सीक्रेट BASE_URL=https://आपका-डोमेन npm start`
3. `public/index.html` फ्रंट-एंड है और सीधे इसी सर्वर की API से जुड़ा है। ब्राउज़र में http://localhost:3000 खोलें। QR का लिंक `BASE_URL/#username` बनता है।
API: /signup /login /me /shop/:un /qr/:un.png /items /follow/:shop /followers /following /chats /messages/:id /upload /broadcast /status /orders + Socket.io (send, typing, msg)
