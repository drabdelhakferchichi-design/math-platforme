const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const multer = require('multer');

const app = express();
const PORT = 3000;

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

// ============ DOSSIERS ============
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const COURSE_UPLOADS = path.join(UPLOADS_DIR, 'courses');
const HOMEWORK_UPLOADS = path.join(UPLOADS_DIR, 'homework');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(COURSE_UPLOADS)) fs.mkdirSync(COURSE_UPLOADS, { recursive: true });
if (!fs.existsSync(HOMEWORK_UPLOADS)) fs.mkdirSync(HOMEWORK_UPLOADS, { recursive: true });

// ============ FICHIERS DE DONNÉES ============
const STUDENTS_FILE = path.join(DATA_DIR, 'students.json');
const COURSES_FILE = path.join(DATA_DIR, 'courses.json');
const MATERIALS_FILE = path.join(DATA_DIR, 'materials.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const HOMEWORK_FILE = path.join(DATA_DIR, 'homework.json');
const REGISTRATIONS_FILE = path.join(DATA_DIR, 'registrations.json');

function initFile(file, defaultData) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(defaultData, null, 2));
    }
}

initFile(COURSES_FILE, [
    { id: 'Edexcel - Pré-IG', name: 'Edexcel - Pré-IG' },
    { id: 'Edexcel - O Level', name: 'Edexcel - O Level' },
    { id: 'Edexcel - A Level', name: 'Edexcel - A Level' },
    { id: 'Cambridge - Pré-IG', name: 'Cambridge - Pré-IG' },
    { id: 'Cambridge - O Level', name: 'Cambridge - O Level' },
    { id: 'Cambridge - A Level', name: 'Cambridge - A Level' }
]);

initFile(STUDENTS_FILE, []);
initFile(MATERIALS_FILE, {});
initFile(MESSAGES_FILE, []);
initFile(HOMEWORK_FILE, []);
initFile(REGISTRATIONS_FILE, []);

function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

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

// ============ LOGIN ============
app.post('/api/login', (req, res) => {
    const { username, password, role } = req.body;
    const students = readJSON(STUDENTS_FILE);
    
    if (role === 'admin') {
        if (username === 'admin' && password === 'admin123') {
            req.session.userId = 1;
            req.session.role = 'admin';
            return res.json({ success: true, role: 'admin' });
        }
    } else {
        const student = students.find(s => s.username === username && s.password === password);
        if (student) {
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
app.post('/api/register-request', (req, res) => {
    const { name, email, phone, course, learningMode, sessionCount } = req.body;
    const registrations = readJSON(REGISTRATIONS_FILE);
    registrations.push({
        id: Date.now(), name, email, phone: phone || '',
        course, learningMode, sessionCount: sessionCount || '2',
        date: new Date().toISOString(), status: 'pending'
    });
    writeJSON(REGISTRATIONS_FILE, registrations);
    res.json({ success: true });
});

app.get('/api/admin/registrations', (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    res.json(readJSON(REGISTRATIONS_FILE));
});

app.delete('/api/admin/delete-request/:id', (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    let registrations = readJSON(REGISTRATIONS_FILE);
    registrations = registrations.filter(r => r.id != req.params.id);
    writeJSON(REGISTRATIONS_FILE, registrations);
    res.json({ success: true });
});

// ============ CONTACT ============
app.post('/api/contact', (req, res) => {
    const { name, email, subject, message } = req.body;
    const messages = readJSON(MESSAGES_FILE);
    messages.push({
        id: Date.now(),
        fromId: 0,
        fromName: name,
        toId: 1,
        toName: 'Professeur',
        subject: subject || 'Message de contact',
        message: message,
        status: 'unread',
        date: new Date().toISOString()
    });
    writeJSON(MESSAGES_FILE, messages);
    res.json({ success: true });
});

// ============ ADMIN - ÉTUDIANTS ============
app.get('/api/admin/students', (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    res.json(readJSON(STUDENTS_FILE));
});

app.post('/api/admin/add-student', (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { name, email, course, mode, username, password } = req.body;
    const students = readJSON(STUDENTS_FILE);
    if (students.find(s => s.username === username)) {
        return res.json({ success: false, message: 'Username existe déjà' });
    }
    students.push({
        id: Date.now(), name, email: email || '',
        courseId: course, courseName: course,
        mode, username, password,
        registrationDate: new Date().toISOString()
    });
    writeJSON(STUDENTS_FILE, students);
    res.json({ success: true });
});

app.delete('/api/admin/delete-student/:id', (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    let students = readJSON(STUDENTS_FILE);
    students = students.filter(s => s.id != req.params.id);
    writeJSON(STUDENTS_FILE, students);
    res.json({ success: true });
});

// ============ ADMIN - COURS ============
app.get('/api/admin/courses', (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    res.json(readJSON(COURSES_FILE));
});

app.get('/api/admin/materials/:courseId', (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const materials = readJSON(MATERIALS_FILE);
    const courseId = decodeURIComponent(req.params.courseId);
    res.json(materials[courseId] || { sessions: [], pastSessions: [], worksheets: [], pastpapers: [] });
});

app.post('/api/admin/add-session', (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { courseId, title, date, time, link } = req.body;
    const materials = readJSON(MATERIALS_FILE);
    if (!materials[courseId]) materials[courseId] = { sessions: [], pastSessions: [], worksheets: [], pastpapers: [] };
    materials[courseId].sessions.push({ id: Date.now(), title, date, time, link });
    writeJSON(MATERIALS_FILE, materials);
    res.json({ success: true });
});

app.post('/api/admin/add-past-session', (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { courseId, title, date, link } = req.body;
    const materials = readJSON(MATERIALS_FILE);
    if (!materials[courseId]) materials[courseId] = { sessions: [], pastSessions: [], worksheets: [], pastpapers: [] };
    materials[courseId].pastSessions.push({ id: Date.now(), title, date, link });
    writeJSON(MATERIALS_FILE, materials);
    res.json({ success: true });
});

app.post('/api/admin/add-worksheet', upload.single('file'), (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { courseId, title } = req.body;
    const fileUrl = req.file ? `/uploads/courses/${req.file.filename}` : null;
    const materials = readJSON(MATERIALS_FILE);
    if (!materials[courseId]) materials[courseId] = { sessions: [], pastSessions: [], worksheets: [], pastpapers: [] };
    materials[courseId].worksheets.push({ id: Date.now(), title, link: fileUrl });
    writeJSON(MATERIALS_FILE, materials);
    res.json({ success: true });
});

app.post('/api/admin/add-pastpaper', upload.single('file'), (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { courseId, title, year } = req.body;
    const fileUrl = req.file ? `/uploads/courses/${req.file.filename}` : null;
    const materials = readJSON(MATERIALS_FILE);
    if (!materials[courseId]) materials[courseId] = { sessions: [], pastSessions: [], worksheets: [], pastpapers: [] };
    materials[courseId].pastpapers.push({ id: Date.now(), title, year, link: fileUrl });
    writeJSON(MATERIALS_FILE, materials);
    res.json({ success: true });
});

app.delete('/api/admin/delete-material/:courseId/:type/:id', (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { courseId, type, id } = req.params;
    const materials = readJSON(MATERIALS_FILE);
    const decoded = decodeURIComponent(courseId);
    if (materials[decoded] && materials[decoded][type]) {
        materials[decoded][type] = materials[decoded][type].filter(item => item.id != id);
        writeJSON(MATERIALS_FILE, materials);
    }
    res.json({ success: true });
});

// ============ MESSAGES ============
app.get('/api/messages', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Non autorisé' });
    const messages = readJSON(MESSAGES_FILE);
    const filtered = messages.filter(m => m.fromId === req.session.userId || m.toId === req.session.userId);
    filtered.sort((a, b) => b.id - a.id);
    res.json(filtered);
});

app.post('/api/send-message', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Non autorisé' });
    const { toId, subject, message } = req.body;
    const students = readJSON(STUDENTS_FILE);
    const fromName = req.session.role === 'admin' ? 'Professeur' : students.find(s => s.id === req.session.userId)?.name;
    const toName = req.session.role === 'admin' ? students.find(s => s.id === toId)?.name : 'Professeur';
    const messages = readJSON(MESSAGES_FILE);
    messages.push({
        id: Date.now(),
        fromId: req.session.userId, fromName,
        toId: parseInt(toId), toName,
        subject, message,
        date: new Date().toISOString()
    });
    writeJSON(MESSAGES_FILE, messages);
    res.json({ success: true });
});

// ============ ÉTUDIANT ============
app.get('/api/student/materials', (req, res) => {
    if (req.session.role !== 'student') return res.status(401).json({ error: 'Non autorisé' });
    const students = readJSON(STUDENTS_FILE);
    const student = students.find(s => s.id === req.session.userId);
    if (!student) return res.json({ error: 'Non trouvé' });
    const materials = readJSON(MATERIALS_FILE);
    const courseMaterials = materials[student.courseId] || { sessions: [], pastSessions: [], worksheets: [], pastpapers: [] };
    res.json({ student: { name: student.name, courseName: student.courseName }, materials: courseMaterials });
});

// ============ DEVOIRS ============
app.post('/api/submit-homework', upload.single('file'), (req, res) => {
    if (req.session.role !== 'student') return res.status(401).json({ error: 'Non autorisé' });
    const { title, description } = req.body;
    const homework = readJSON(HOMEWORK_FILE);
    homework.push({
        id: Date.now(),
        studentId: req.session.userId,
        title, description: description || '',
        fileUrl: req.file ? `/uploads/homework/${req.file.filename}` : null,
        status: 'pending',
        date: new Date().toISOString(),
        grade: null, feedback: null
    });
    writeJSON(HOMEWORK_FILE, homework);
    res.json({ success: true });
});

app.get('/api/my-homework', (req, res) => {
    if (req.session.role !== 'student') return res.status(401).json({ error: 'Non autorisé' });
    const homework = readJSON(HOMEWORK_FILE);
    res.json(homework.filter(h => h.studentId === req.session.userId));
});

app.get('/api/admin/homework/:studentId', (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const homework = readJSON(HOMEWORK_FILE);
    res.json(homework.filter(h => h.studentId == req.params.studentId));
});

app.post('/api/admin/grade-homework', (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const { homeworkId, grade, feedback } = req.body;
    const homework = readJSON(HOMEWORK_FILE);
    const hw = homework.find(h => h.id === homeworkId);
    if (hw) {
        hw.grade = grade;
        hw.feedback = feedback;
        hw.status = 'graded';
        writeJSON(HOMEWORK_FILE, homework);
    }
    res.json({ success: true });
});

// ============ DIAGNOSTIC ============
app.get('/api/check-file/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'uploads/homework', filename);
    if (fs.existsSync(filePath)) {
        res.json({ exists: true, path: filePath, size: fs.statSync(filePath).size });
    } else {
        res.json({ exists: false, path: filePath });
    }
});

// ============ STATS ============
app.get('/api/stats', (req, res) => {
    if (req.session.role !== 'admin') return res.status(401).json({ error: 'Non autorisé' });
    const students = readJSON(STUDENTS_FILE);
    res.json({ totalStudents: students.length });
});

// ============ DÉMARRAGE ============
app.listen(PORT, () => {
    console.log(`\n✅ Serveur démarré sur http://localhost:${PORT}`);
    console.log(`🔐 Admin: admin / admin123`);
});