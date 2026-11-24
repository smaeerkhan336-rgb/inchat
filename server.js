// In Chat backend: Node.js + Express + Socket.io + SQLite
// Run: npm install && JWT_SECRET=kuch-bhi-lamba-secret npm start
require('dotenv').config();
const express=require('express'),http=require('http'),cors=require('cors'),path=require('path'),fs=require('fs');
const Database=require('better-sqlite3'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken');
const multer=require('multer'),QR=require('qrcode'),{Server}=require('socket.io');
const SECRET=process.env.JWT_SECRET||'change-me',BASE=process.env.BASE_URL||'http://localhost:3000';
fs.mkdirSync('uploads',{recursive:true});
const db=new Database(path.join(__dirname,'inchat.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name,gmail UNIQUE,phone UNIQUE,username UNIQUE,pass,role,about DEFAULT '',verified DEFAULT 0);
CREATE TABLE IF NOT EXISTS follows(shop INT,cust INT,ts INT,PRIMARY KEY(shop,cust));
CREATE TABLE IF NOT EXISTS msgs(id INTEGER PRIMARY KEY,shop INT,cust INT,sender INT,text,file,kind DEFAULT 'text',ts INT,seen INT DEFAULT 0);
CREATE TABLE IF NOT EXISTS status(id INTEGER PRIMARY KEY,uid INT,text,file,ts INT);
CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY,shop INT,name,price,photo);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,shop INT,cust INT,detail,state DEFAULT 'नया',ts INT);`);
const app=express(),srv=http.createServer(app),io=new Server(srv,{cors:{origin:'*'}});
app.use(cors(),express.json(),express.static('public'));
const up=multer({dest:'uploads/',limits:{fileSize:25e6}});app.use('/files',express.static('uploads'));
const sign=u=>jwt.sign({id:u.id,role:u.role},SECRET,{expiresIn:'30d'});
const auth=(q,r,n)=>{try{q.u=jwt.verify((q.headers.authorization||'').slice(7),SECRET);n()}catch{r.status(401).json({e:'login करें'})}};
const wrap=f=>(q,r)=>{try{f(q,r)}catch(e){r.status(400).json({e:e.message})}};

// ---- खाता ----
app.post('/signup',wrap(async(q,r)=>{const{name,gmail,phone,username,password,role}=q.body;
 if(!/^\S+@gmail\.com$/i.test(gmail)||!/^\d{10}$/.test(phone)||!/^[a-z0-9-]{3,20}$/.test(username)||(password||'').length<6)throw Error('जानकारी सही नहीं');
 const i=db.prepare('INSERT INTO users(name,gmail,phone,username,pass,role) VALUES(?,?,?,?,?,?)').run(name,gmail,phone,username,bcrypt.hashSync(password,10),role==='shop'?'shop':'cust');
 r.json({token:sign({id:i.lastInsertRowid,role})})}));
app.post('/login',wrap((q,r)=>{const u=db.prepare('SELECT * FROM users WHERE username=? OR gmail=? OR phone=?').get(q.body.id,q.body.id,q.body.id);
 if(!u||!bcrypt.compareSync(q.body.password,u.pass))throw Error('गलत पासवर्ड');r.json({token:sign(u)})}));
app.get('/me',auth,(q,r)=>r.json(db.prepare('SELECT id,name,gmail,phone,username,role,about FROM users WHERE id=?').get(q.u.id)));

// ---- दुकान, QR, कैटलॉग ----
app.get('/shop/:un',(q,r)=>{const s=db.prepare("SELECT id,name,username,about,verified FROM users WHERE username=? AND role='shop'").get(q.params.un);
 if(!s)return r.status(404).json({e:'दुकान नहीं मिली'});
 s.followers=db.prepare('SELECT COUNT(*) c FROM follows WHERE shop=?').get(s.id).c;
 s.items=db.prepare('SELECT * FROM items WHERE shop=?').all(s.id);r.json(s)});
app.get('/qr/:un.png',async(q,r)=>{r.type('png').send(await QR.toBuffer(`${BASE}/#${q.params.un}`,{width:600,margin:2}))});
app.post('/items',auth,(q,r)=>{db.prepare('INSERT INTO items(shop,name,price,photo) VALUES(?,?,?,?)').run(q.u.id,q.body.name,q.body.price,q.body.photo||'');r.json({ok:1})});

// ---- फॉलो सिस्टम ----
app.post('/follow/:shop',auth,(q,r)=>{db.prepare('INSERT OR IGNORE INTO follows VALUES(?,?,?)').run(+q.params.shop,q.u.id,Date.now());r.json({ok:1})});
app.delete('/follow/:shop',auth,(q,r)=>{db.prepare('DELETE FROM follows WHERE shop=? AND cust=?').run(+q.params.shop,q.u.id);r.json({ok:1})});
app.get('/followers',auth,(q,r)=>r.json(db.prepare('SELECT u.id,u.name,u.username FROM follows f JOIN users u ON u.id=f.cust WHERE f.shop=?').all(q.u.id)));
app.get('/following',auth,(q,r)=>r.json(db.prepare('SELECT u.id,u.name,u.username FROM follows f JOIN users u ON u.id=f.shop WHERE f.cust=?').all(q.u.id)));

// ---- चैट ----
function save(shop,cust,sender,text,file,kind){const ts=Date.now();
 const i=db.prepare('INSERT INTO msgs(shop,cust,sender,text,file,kind,ts) VALUES(?,?,?,?,?,?,?)').run(shop,cust,sender,text||'',file||'',kind||'text',ts);
 const m={id:i.lastInsertRowid,shop,cust,sender,text,file,kind,ts};io.to('u'+shop).to('u'+cust).emit('msg',m);return m}
app.get('/chats',auth,(q,r)=>{const col=q.u.role==='shop'?'shop':'cust',oth=q.u.role==='shop'?'cust':'shop';
 r.json(db.prepare(`SELECT u.id,u.name,u.username,(SELECT text FROM msgs m WHERE m.${col}=? AND m.${oth}=u.id ORDER BY ts DESC LIMIT 1) last,
 (SELECT COUNT(*) FROM msgs m WHERE m.${col}=? AND m.${oth}=u.id AND sender<>? AND seen=0) unread FROM users u
 WHERE u.id IN(SELECT ${oth} FROM msgs WHERE ${col}=?)`).all(q.u.id,q.u.id,q.u.id,q.u.id))});
app.get('/messages/:other',auth,(q,r)=>{const[s,c]=q.u.role==='shop'?[q.u.id,+q.params.other]:[+q.params.other,q.u.id];
 db.prepare('UPDATE msgs SET seen=1 WHERE shop=? AND cust=? AND sender<>?').run(s,c,q.u.id);
 r.json(db.prepare('SELECT * FROM msgs WHERE shop=? AND cust=? ORDER BY ts').all(s,c))});
app.post('/upload',auth,up.single('f'),(q,r)=>r.json({url:'/files/'+q.file.filename,kind:q.file.mimetype.split('/')[0]}));
app.post('/broadcast',auth,(q,r)=>{if(q.u.role!=='shop')return r.status(403).end();
 const f=db.prepare('SELECT cust FROM follows WHERE shop=?').all(q.u.id);f.forEach(x=>save(q.u.id,x.cust,q.u.id,'📢 '+q.body.text));r.json({sent:f.length})});

// ---- स्टेटस (24 घंटे) ----
app.post('/status',auth,(q,r)=>{db.prepare('INSERT INTO status(uid,text,file,ts) VALUES(?,?,?,?)').run(q.u.id,q.body.text||'',q.body.file||'',Date.now());r.json({ok:1})});
app.get('/status',auth,(q,r)=>r.json(db.prepare(`SELECT s.*,u.name,u.username FROM status s JOIN users u ON u.id=s.uid WHERE ts>? AND (s.uid IN(SELECT shop FROM follows WHERE cust=?) OR s.uid=?) ORDER BY ts DESC`).all(Date.now()-864e5,q.u.id,q.u.id)));

// ---- ऑर्डर ट्रैकिंग ----
app.post('/orders',auth,(q,r)=>{const i=db.prepare('INSERT INTO orders(shop,cust,detail,ts) VALUES(?,?,?,?)').run(q.body.shop,q.u.id,q.body.detail,Date.now());
 save(q.body.shop,q.u.id,q.u.id,'🛒 नया ऑर्डर #'+i.lastInsertRowid+': '+q.body.detail,'','order');r.json({id:i.lastInsertRowid})});
app.patch('/orders/:id',auth,(q,r)=>{const o=db.prepare('SELECT * FROM orders WHERE id=? AND shop=?').get(+q.params.id,q.u.id);if(!o)return r.status(404).end();
 db.prepare('UPDATE orders SET state=? WHERE id=?').run(q.body.state,o.id);save(o.shop,o.cust,q.u.id,`📦 ऑर्डर #${o.id}: ${q.body.state}`,'','order');r.json({ok:1})});

// ---- रीयल-टाइम ----
io.use((s,n)=>{try{s.u=jwt.verify(s.handshake.auth.token,SECRET);n()}catch{n(Error('auth'))}});
io.on('connection',s=>{s.join('u'+s.u.id);
 s.on('send',({other,text,file,kind})=>{const[a,b]=s.u.role==='shop'?[s.u.id,other]:[other,s.u.id];save(a,b,s.u.id,text,file,kind)});
 s.on('typing',o=>io.to('u'+o).emit('typing',s.u.id))});
srv.listen(3000,()=>console.log('In Chat चालू: '+BASE));
