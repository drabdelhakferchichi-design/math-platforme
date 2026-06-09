const express = require('express');
const cors = require('cors');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration PostgreSQL (Railway fournit DATABASE_URL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static('.'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
    secret: 'abdelhak-math-secret-2026',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// ============ DOSSIERS UPLOADS ============
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const COURSE_UPLOADS = path.join(UPLOADS_DIR, 'courses');
const HOMEWORK_UPLOADS = path.join(UPLOADS_DIR, 'homework');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(COURSE_UPLOADS)) fs.mkdirSync(COURSE_UPLOADS, { recursive: true });
if (!fs.existsSync(HOMEWORK_UPLOADS)) fs.mkdirSync(HOMEWORK_UPLOADS, { recursive: true });

// ============ MULTER ============
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'homework') cb(null, HOMEWORK_UPLOADS);
        else cb(null, COURSE_UPLOADS);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});
const upload = multer({ storage: storage });

// ============ INITIALISATION DE LA BASE DE DONNÉES ============
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS students (
            id SERIAL PRIMARY KEY,
            name TEXT,
            email TEXT,
            course_id TEXT,
            course_name TEXT,
            mode TEXT,
            username TEXT UNIQUE,
            password TEXT,
            registration_date TEXT
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS materials (
            course_id TEXT PRIMARY KEY,
            sessions JSONB DEFAULT '[]',
            past_sessions JSONB DEFAULT '[]',
            worksheets JSONB DEFAULT '[]',
            pastpapers JSONB DEFAULT '[]'
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id SERIAL PRIMARY KEY,
            from_id TEXT,
            from_name TEXT,
            to_id TEXT,
            to_name TEXT,
            subject TEXT,
            message TEXT,
            date TEXT
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS homework (
            id SERIAL PRIMARY KEY,
            student_id TEXT,
            title TEXT,
            description TEXT,
            file_url TEXT,
            status TEXT,
            date TEXT,
            grade TEXT,
            feedback TEXT
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS registrations (
            id SERIAL PRIMARY KEY,
            name TEXT,
            email TEXT,
            phone TEXT,
            course TEXT,
            learning_mode TEXT,
            session_count TEXT,
            date TEXT,
            status TEXT
        )
    `);
    console.log('✅ Base de données initialisée');
}

// ============ LOGIN ============
app.post('/api/login', async (req, res) => {
    const { username, password, role } = req.body;
    
    if (role === 'admin') {
        if (username === 'admin' && password === 'admin123') {
            req.session.userId = 1;
            req.session.role = 'admin';
            return res.json({ success: true, role: 'admin' });
        }
    } else {
        const result = await pool.query('SELECT * FROM students WHERE username = $1 AND password = $2', [username, password]);
        if (result.rows.length > 0) {
            const student = result.rows[0];
            req.session.userId = student.id;
            req.session.role = 'student';
            return res.json({ success: true, role: 'student', name: student.name });
        }
    }
    res.json({ success: false, message: 'Identifiants incorrects' });
});

app.get('/api/check-session', (req, res) => {
    res.json({ loggedIn: !!req.session.userId, role: req.session.role });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ============ DEMANDES INSCRIPTION ============
app.post('/api/register-request', async (req, res) => {
    const { name, email, phone, course, learningMode, sessionCount } = req.body;
    await pool.query(
        'INSERT INTO registrations (name, email, phone, course, learning_mode, session_count, date, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [name, email, phone || '', course, learningMode, sessionCount || '2', new Date().toISOString(), 'pending']
    );
    res.json({ success: true });
});

app.get('/api/admin/registrations', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const result = await pool.query('SELECT * FROM registrations');
    res.json(result.rows);
});

app.delete('/api/admin/delete-request/:id', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    await pool.query('DELETE FROM registrations WHERE id = $1', [req.params.id]);
    res.json({ success: true });
});

// ============ CONTACT ============
app.post('/api/contact', async (req, res) => {
    const { name, email, subject, message } = req.body;
    await pool.query(
        'INSERT INTO messages (from_id, from_name, to_id, to_name, subject, message, date) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [0, name, 1, 'Professeur', subject || 'Message de contact', message, new Date().toISOString()]
    );
    res.json({ success: true });
});

// ============ ADMIN - ÉTUDIANTS ============
app.get('/api/admin/students', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const result = await pool.query('SELECT * FROM students');
    res.json(result.rows);
});

app.post('/api/admin/add-student', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { name, email, course, mode, username, password } = req.body;
    const existing = await pool.query('SELECT * FROM students WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
        return res.json({ success: false, message: 'Username existe déjà' });
    }
    await pool.query(
        'INSERT INTO students (name, email, course_id, course_name, mode, username, password, registration_date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [name, email || '', course, course, mode, username, password, new Date().toISOString()]
    );
    res.json({ success: true });
});

app.delete('/api/admin/delete-student/:id', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    await pool.query('DELETE FROM students WHERE id = $1', [req.params.id]);
    res.json({ success: true });
});

// ============ ADMIN - COURS ============
app.get('/api/admin/materials/:courseId', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const courseId = decodeURIComponent(req.params.courseId);
    const result = await pool.query('SELECT * FROM materials WHERE course_id = $1', [courseId]);
    if (result.rows.length === 0) {
        res.json({ sessions: [], pastSessions: [], worksheets: [], pastpapers: [] });
    } else {
        res.json(result.rows[0]);
    }
});

app.post('/api/admin/add-session', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { courseId, title, date, time, link } = req.body;
    const existing = await pool.query('SELECT * FROM materials WHERE course_id = $1', [courseId]);
    const newSession = { id: Date.now(), title, date, time, link };
    
    if (existing.rows.length === 0) {
        await pool.query(
            'INSERT INTO materials (course_id, sessions) VALUES ($1, $2)',
            [courseId, JSON.stringify([newSession])]
        );
    } else {
        const sessions = existing.rows[0].sessions || [];
        sessions.push(newSession);
        await pool.query('UPDATE materials SET sessions = $1 WHERE course_id = $2', [JSON.stringify(sessions), courseId]);
    }
    res.json({ success: true });
});

app.post('/api/admin/add-past-session', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { courseId, title, date, link } = req.body;
    const existing = await pool.query('SELECT * FROM materials WHERE course_id = $1', [courseId]);
    const newSession = { id: Date.now(), title, date, link };
    
    if (existing.rows.length === 0) {
        await pool.query(
            'INSERT INTO materials (course_id, past_sessions) VALUES ($1, $2)',
            [courseId, JSON.stringify([newSession])]
        );
    } else {
        const pastSessions = existing.rows[0].past_sessions || [];
        pastSessions.push(newSession);
        await pool.query('UPDATE materials SET past_sessions = $1 WHERE course_id = $2', [JSON.stringify(pastSessions), courseId]);
    }
    res.json({ success: true });
});

app.post('/api/admin/add-worksheet', upload.single('file'), async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { courseId, title } = req.body;
    const fileUrl = req.file ? `/uploads/courses/${req.file.filename}` : null;
    const existing = await pool.query('SELECT * FROM materials WHERE course_id = $1', [courseId]);
    const newItem = { id: Date.now(), title, link: fileUrl };
    
    if (existing.rows.length === 0) {
        await pool.query(
            'INSERT INTO materials (course_id, worksheets) VALUES ($1, $2)',
            [courseId, JSON.stringify([newItem])]
        );
    } else {
        const worksheets = existing.rows[0].worksheets || [];
        worksheets.push(newItem);
        await pool.query('UPDATE materials SET worksheets = $1 WHERE course_id = $2', [JSON.stringify(worksheets), courseId]);
    }
    res.json({ success: true });
});

app.post('/api/admin/add-pastpaper', upload.single('file'), async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { courseId, title, year } = req.body;
    const fileUrl = req.file ? `/uploads/courses/${req.file.filename}` : null;
    const existing = await pool.query('SELECT * FROM materials WHERE course_id = $1', [courseId]);
    const newItem = { id: Date.now(), title, year, link: fileUrl };
    
    if (existing.rows.length === 0) {
        await pool.query(
            'INSERT INTO materials (course_id, pastpapers) VALUES ($1, $2)',
            [courseId, JSON.stringify([newItem])]
        );
    } else {
        const pastpapers = existing.rows[0].pastpapers || [];
        pastpapers.push(newItem);
        await pool.query('UPDATE materials SET pastpapers = $1 WHERE course_id = $2', [JSON.stringify(pastpapers), courseId]);
    }
    res.json({ success: true });
});

app.delete('/api/admin/delete-material/:courseId/:type/:id', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { courseId, type, id } = req.params;
    const result = await pool.query('SELECT * FROM materials WHERE course_id = $1', [courseId]);
    if (result.rows.length > 0) {
        const materials = result.rows[0];
        const items = materials[type] || [];
        const filtered = items.filter(item => item.id != id);
        await pool.query(`UPDATE materials SET ${type} = $1 WHERE course_id = $2`, [JSON.stringify(filtered), courseId]);
    }
    res.json({ success: true });
});

// ============ MESSAGES ============
app.get('/api/messages', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Non autorisé' });
    const result = await pool.query('SELECT * FROM messages');
    res.json(result.rows);
});

app.post('/api/send-message', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Non autorisé' });
    const { toId, subject, message } = req.body;
    const fromName = req.session.role === 'admin' ? 'Professeur' : 'Étudiant';
    await pool.query(
        'INSERT INTO messages (from_id, from_name, to_id, to_name, subject, message, date) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [req.session.userId.toString(), fromName, toId, 'Professeur', subject, message, new Date().toISOString()]
    );
    res.json({ success: true });
});

// ============ ÉTUDIANT ============
app.get('/api/student/materials', async (req, res) => {
    if (req.session.role !== 'student') return res.status(401).json({ error: 'Non autorisé' });
    const studentResult = await pool.query('SELECT * FROM students WHERE id = $1', [req.session.userId]);
    if (studentResult.rows.length === 0) return res.json({ error: 'Non trouvé' });
    const student = studentResult.rows[0];
    const materialsResult = await pool.query('SELECT * FROM materials WHERE course_id = $1', [student.course_id]);
    const materials = materialsResult.rows.length > 0 ? materialsResult.rows[0] : { sessions: [], past_sessions: [], worksheets: [], pastpapers: [] };
    res.json({ student: { name: student.name, courseName: student.course_name }, materials });
});

// ============ DEVOIRS ============
app.post('/api/submit-homework', upload.single('file'), async (req, res) => {
    if (req.session.role !== 'student') return res.status(401).json({ error: 'Non autorisé' });
    const { title, description } = req.body;
    const fileUrl = req.file ? `/uploads/homework/${req.file.filename}` : null;
    await pool.query(
        'INSERT INTO homework (student_id, title, description, file_url, status, date) VALUES ($1, $2, $3, $4, $5, $6)',
        [req.session.userId.toString(), title, description || '', fileUrl, 'pending', new Date().toISOString()]
    );
    res.json({ success: true });
});

app.get('/api/my-homework', async (req, res) => {
    if (req.session.role !== 'student') return res.status(401).json({ error: 'Non autorisé' });
    const result = await pool.query('SELECT * FROM homework WHERE student_id = $1', [req.session.userId.toString()]);
    res.json(result.rows);
});

app.get('/api/admin/homework/:studentId', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const result = await pool.query('SELECT * FROM homework WHERE student_id = $1', [req.params.studentId]);
    res.json(result.rows);
});

app.post('/api/admin/grade-homework', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { homeworkId, grade, feedback } = req.body;
    await pool.query(
        'UPDATE homework SET grade = $1, feedback = $2, status = $3 WHERE id = $4',
        [grade, feedback, 'graded', homeworkId]
    );
    res.json({ success: true });
});

app.get('/api/stats', async (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const result = await pool.query('SELECT COUNT(*) FROM students');
    res.json({ totalStudents: parseInt(result.rows[0].count) });
});

// ============ DÉMARRAGE ============
initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`\n✅ Serveur démarré sur http://localhost:${PORT}`);
        console.log(`🔐 Admin: admin / admin123`);
        console.log(`📁 PostgreSQL connecté`);
    });
});
