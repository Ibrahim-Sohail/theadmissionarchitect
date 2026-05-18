require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
const path = require('path');
const cookieSession = require('cookie-session'); // ✅ Added cookie-session

const app = express();
const port = process.env.PORT || 3001; // ✅ Better port handling for Vercel

// ✅ Live Backend URL Connection
const API_BASE = 'https://theadmissionarchitect.onrender.com';

async function apiPost(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error(`Backend Error: ${text.substring(0, 50)}...`); }
    if (!res.ok) throw new Error(data.detail || data.error || 'API error');
    return data;
}

async function apiGet(path) {
    const res = await fetch(`${API_BASE}${path}`);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error(`Backend Error: ${text.substring(0, 50)}...`); }
    if (!res.ok) throw new Error(data.detail || data.error || 'API error');
    return data;
}

// Set up EJS and absolute path for views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); 

// Set up absolute path for public files (CSS, Images)
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ✅ NEW: Serverless-safe Session Management
app.use(cookieSession({
    name: 'taa-session',
    keys: [process.env.SESSION_SECRET || 'fallback-secret-key-123'], // Uses an env variable or fallback
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
}));

// ✅ NEW: Map the secure cookie data back to your existing req.currentUser logic
app.use((req, res, next) => {
    req.currentUser = req.session.currentUser || null;
    next();
});

function requireAuth(req, res, next) {
    if (!req.currentUser) return res.redirect('/login');
    next();
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});

// --- AUTH ROUTES ---
app.get('/', (req, res) => res.render('landing', { page: 'landing' }));
app.get('/login', (req, res) => { if (req.currentUser) return res.redirect('/home'); res.render('login', { page: 'login', error: null, mode: 'login' }); });
app.get('/signup', (req, res) => { if (req.currentUser) return res.redirect('/home'); res.render('login', { page: 'login', error: null, mode: 'signup' }); });

// Catch the email verification link
app.get('/verify', async (req, res) => {
    const token = req.query.token;

    if (!token) {
        return res.send("<h2 style='text-align:center; margin-top:50px; font-family:sans-serif;'>Invalid verification link.</h2>");
    }

    try {
        const backendUrl = `https://theadmissionarchitect.onrender.com/api/auth/verify/${token}`;
        const response = await fetch(backendUrl);
        const data = await response.json();

        if (data.success) {
            res.redirect('/login?verified=true');
        } else {
            res.send(`<h2 style='text-align:center; margin-top:50px; font-family:sans-serif;'>Verification failed: ${data.detail || "Link expired."}</h2>`);
        }
    } catch (error) {
        console.error("Verification Error:", error);
        res.send("<h2 style='text-align:center; margin-top:50px; font-family:sans-serif;'>Error connecting to verification server. Please try again later.</h2>");
    }
});

app.post('/signup', async (req, res) => {
    const { username, email, password, confirm_password } = req.body;
    if (!username || username.trim().length < 3) return res.render('login', { page: 'login', mode: 'signup', error: 'Username must be at least 3 characters.' });
    if (password !== confirm_password) return res.render('login', { page: 'login', mode: 'signup', error: 'Passwords do not match.' });

    try {
        const data = await apiPost('/api/auth/signup', { username: username.trim(), email, password });
        const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
        const verifyLink = `${baseUrl}/verify?token=${data.verification_token}`;
        await transporter.sendMail({
            from: `"The Admission Architect" <${process.env.GMAIL_USER}>`,
            to: data.email,
            subject: 'Verify Your Email',
            html: `<div style="font-family: Arial, sans-serif; padding: 20px;"><h2>Welcome!</h2><a href="${verifyLink}" style="background: #1976D2; color: white; padding: 10px 20px; text-decoration: none;">Verify My Email</a></div>`
        });
        res.render('login', { page: 'login', mode: 'login', error: '✅ Account created! Check your email to verify before logging in.' });
    } catch (err) { res.render('login', { page: 'login', mode: 'signup', error: err.message }); }
});

app.get('/verify/:token', async (req, res) => {
    try {
        await apiGet(`/api/auth/verify/${req.params.token}`);
        res.render('login', { page: 'login', mode: 'login', error: '✅ Email verified! You can now log in.' });
    } catch (err) { res.render('login', { page: 'login', mode: 'login', error: '❌ Invalid link.' }); }
});

app.post('/login', async (req, res) => {
    try {
        const data = await apiPost('/api/auth/login', { email: req.body.email, password: req.body.password });
        
        // ✅ NEW: Save user data securely in the browser cookie! No more server memory wipe!
        req.session.currentUser = { user_id: data.user_id, username: data.username, email: data.email, token: data.token };
        
        res.redirect('/home');
    } catch (err) {
        if (err.message === 'EMAIL_NOT_VERIFIED') return res.render('login', { page: 'login', mode: 'login', error: '⚠️ Please verify your email first.' });
        res.render('login', { page: 'login', mode: 'login', error: err.message });
    }
});

app.get('/logout', (req, res) => {
    req.session = null; // ✅ NEW: Destroy the cookie securely
    res.redirect('/login');
});

// --- MAIN PORTAL ROUTES ---
app.get('/home', requireAuth, (req, res) => res.render('home', { user: req.currentUser.username, upcoming: null, page: 'home' }));
app.get('/profile', requireAuth, async (req, res) => {
    let history = [], chatHistory = [], profile = { exists: false };
    try {
        const [progressData, chatData, profileData] = await Promise.all([ apiGet(`/api/progress/${req.currentUser.user_id}`), apiGet(`/api/chat/history/${req.currentUser.user_id}`), apiGet(`/api/profile/${req.currentUser.user_id}`) ]);
        history = progressData.history || []; chatHistory = chatData.history || []; profile = profileData;
    } catch (e) {}
    res.render('profile', { user: { name: req.currentUser.username, email: req.currentUser.email, phone: '', photo: '' }, bookings: [], favorites: [], docs: {}, history, chatHistory, profile, page: 'profile' });
});

app.post('/update-profile', requireAuth, (req, res) => res.redirect('/profile'));

app.get('/university', requireAuth, (req, res) => res.render('university', { page: 'university', user_id: req.currentUser.user_id }));
app.post('/api/universities/recommend', requireAuth, async (req, res) => {
    try {
        if (req.body.cgpa) await apiPost('/api/profile/save', { user_id: req.currentUser.user_id, cgpa: parseFloat(req.body.cgpa), major_interest: req.body.major_interest || 'CS', budget_min: parseFloat(req.body.budget_min)||10000, budget_max: parseFloat(req.body.budget_max)||30000, preferred_country: req.body.preferred_country||'Any' });
        res.json(await apiPost('/api/universities/recommend', { user_id: req.currentUser.user_id }));
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/test-modules', requireAuth, (req, res) => res.render('test-modules', { page: 'test-modules' }));
app.get('/support-bot', requireAuth, (req, res) => res.render('support-bot', { page: 'support-bot' }));

app.get('/module/:type', requireAuth, (req, res) => {
    const ieltsWritingPrompts = ["Some people believe university education should be free. Discuss.", "In many countries, the proportion of older people is increasing. Discuss."];
    const greAnalyticalPrompts = ["'Governments should place few restrictions on research.' Discuss.", "'To understand a society, study its cities.' Discuss."];
    
    const randomIeltsWriting = `<strong>Prompt:</strong> ${ieltsWritingPrompts[Math.floor(Math.random() * ieltsWritingPrompts.length)]}`;
    const randomGreAnalytical = `<strong>Issue:</strong> ${greAnalyticalPrompts[Math.floor(Math.random() * greAnalyticalPrompts.length)]}`;

    const testMap = {
        'listening':  { type: 'listening',  title: "IELTS Listening Practice",   icon: "headphones",    color: "#4CAF50" },
        'reading':    { type: 'reading',    title: "IELTS Reading Practice",     icon: "menu_book",     color: "#FF9800" },
        'writing':    { type: 'writing',    title: "IELTS Writing Task 2",       icon: "edit_document", color: "#F44336", passage: randomIeltsWriting },
        'speaking':   { type: 'speaking',   title: "IELTS Speaking Practice",    icon: "mic",           color: "#9C27B0" },
        'gre-verbal': { type: 'gre-verbal', title: "GRE Verbal Reasoning",       icon: "forum",         color: "#00BFA5" },
        'gre-quant':  { type: 'gre-quant',  title: "GRE Quantitative Reasoning", icon: "calculate",     color: "#0288D1" },
        'gre-analytical': { type: 'gre-analytical', title: "GRE Analytical Writing", icon: "edit_document", color: "#00897B", passage: randomGreAnalytical },
    };
    if (!testMap[req.params.type]) return res.redirect('/test-modules');
    res.render('mock-test', { page: 'test-modules', testData: testMap[req.params.type], user_id: req.currentUser.user_id });
});

// API Proxies
app.post('/api/ielts/reading',        requireAuth, async (req, res) => { try { res.json(await apiPost('/api/ielts/reading',        { user_id: req.currentUser.user_id })); } catch(e){ res.status(500).json({error:e.message}); }});
app.post('/api/ielts/listening',      requireAuth, async (req, res) => { try { res.json(await apiPost('/api/ielts/listening',      { user_id: req.currentUser.user_id })); } catch(e){ res.status(500).json({error:e.message}); }});
app.post('/api/ielts/grade-writing',  requireAuth, async (req, res) => { try { res.json(await apiPost('/api/ielts/grade-writing',  { user_id: req.currentUser.user_id, essay_text: req.body.essay_text })); } catch(e){ res.status(500).json({error:e.message}); }});
app.post('/api/ielts/grade-speaking', requireAuth, async (req, res) => { try { res.json(await apiPost('/api/ielts/grade-speaking', { user_id: req.currentUser.user_id, response_text: req.body.response_text, topic: req.body.topic })); } catch(e){ res.status(500).json({error:e.message}); }});
app.post('/api/ielts/save-score',     requireAuth, async (req, res) => { try { res.json(await apiPost('/api/ielts/save-score',     { user_id: req.currentUser.user_id, ...req.body })); } catch(e){ res.status(500).json({error:e.message}); }});
app.post('/api/gre/question',         requireAuth, async (req, res) => { try { res.json(await apiPost('/api/gre/question',         { user_id: req.currentUser.user_id, topic: req.body.topic })); } catch(e){ res.status(500).json({error:e.message}); }});
app.post('/api/gre/submit-answer',    requireAuth, async (req, res) => { try { res.json(await apiPost('/api/gre/submit-answer',    { user_id: req.currentUser.user_id, ...req.body })); } catch(e){ res.status(500).json({error:e.message}); }});
app.post('/api/gre/grade-essay',      requireAuth, async (req, res) => { try { res.json(await apiPost('/api/gre/grade-essay',      { user_id: req.currentUser.user_id, essay_text: req.body.essay_text })); } catch(e){ res.status(500).json({error:e.message}); }});

app.get('/chat', requireAuth, (req, res) => res.render('chat', { page: 'chat' }));
app.post('/api/chat', requireAuth, async (req, res) => { try { res.json(await apiPost('/api/chat', { user_id: req.currentUser.user_id, message: req.body.message, bot_type: req.body.bot_type || 'general' })); } catch(e) { res.status(500).json({ error: e.message }); }});

// --- STATIC & LEGAL ROUTES ---
app.get('/cost-calculator',      requireAuth, (req, res) => res.render('cost-calculator',      { page: 'cost-calculator' }));
app.get('/booking',              requireAuth, (req, res) => res.render('booking',              { page: 'booking' }));
app.get('/voice',                requireAuth, (req, res) => res.render('voice',                { page: 'test-modules' }));
app.get('/settings',             requireAuth, (req, res) => res.render('settings',             { page: 'settings' }));
app.get('/student-essentials',   requireAuth, (req, res) => res.render('info-student-essentials', { page: 'student-essentials' }));
app.get('/living-abroad',        requireAuth, (req, res) => res.render('info-living-abroad',    { page: 'living-abroad' }));
app.get('/visa',                 requireAuth, (req, res) => res.render('info-visa',            { page: 'visa' }));
app.get('/virtual-counselling',  requireAuth, (req, res) => res.render('info-virtual-counselling', { page: 'virtual-counselling' }));
app.get('/careers',              requireAuth, (req, res) => res.render('info-careers',         { page: 'careers' }));
app.get('/airport-transfer',     requireAuth, (req, res) => res.render('airport-transfer',     { page: 'airport-transfer' }));

// --- INFO ROUTES ---
app.get('/info/test-prep',              requireAuth, (req, res) => res.render('info-test-prep',              { page: 'test-prep' }));
app.get('/info/cost-calculator',        requireAuth, (req, res) => res.render('info-cost-calculator',        { page: 'cost-calculator' }));
app.get('/info/find-university',        requireAuth, (req, res) => res.render('info-find-university',        { page: 'find-university' }));
app.get('/info/living-abroad',          requireAuth, (req, res) => res.render('info-living-abroad',          { page: 'living-abroad' }));
app.get('/info/visa',                   requireAuth, (req, res) => res.render('info-visa',                   { page: 'visa' }));
app.get('/info/student-essentials',     requireAuth, (req, res) => res.render('info-student-essentials',     { page: 'student-essentials' }));
app.get('/info/virtual-counselling',    requireAuth, (req, res) => res.render('info-virtual-counselling',    { page: 'virtual-counselling' }));
app.get('/info/careers',                requireAuth, (req, res) => res.render('info-careers',                { page: 'careers' }));
app.get('/info/privacy',                (req, res) => res.render('info-privacy',                { page: 'privacy' }));
app.get('/info/terms',                  (req, res) => res.render('info-terms',                  { page: 'terms' }));

// Enquire Form Route
app.post('/enquire', async (req, res) => {
    const { name, email, phone, destination, level } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });
    try {
        await transporter.sendMail({
            from: `"The Admission Architect" <${process.env.GMAIL_USER}>`,
            to: email,
            subject: 'We have received your enquiry – The Admission Architect',
            html: `<div style="font-family: Arial, sans-serif; padding: 20px;"><h2>Hello ${name},</h2><p>Thank you for your enquiry. A consultant will contact you at ${phone} regarding your ${level} studies in the ${destination}.</p></div>`
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to send email.' }); }
});

// ✅ Local Listening Command
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => console.log(`✅ Local Frontend is running on http://localhost:${port}`));
}

module.exports = app;