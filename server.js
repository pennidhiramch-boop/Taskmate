
require("dotenv").config();

const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const publicPath = path.join(__dirname, "public");
const dashboardPath = path.join(__dirname, "views", "index.html");

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    if (req.originalUrl.startsWith("/api")) {
        console.log("API REQUEST:", req.method, req.originalUrl);
    }
    next();
});

app.use(session({
    store: new pgSession({
        pool,
        tableName: "taskmate_sessions",
        createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.redirect("/");
    }
    next();
}

async function initializeDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS tasks (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            description TEXT DEFAULT '',
            status VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'completed')),
            due_date DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log("Database tables ready!");
}

const databaseReady = initializeDatabase();

app.use(async (req, res, next) => {
    try {
        await databaseReady;
        next();
    } catch (error) {
        console.error("Database initialization error:", error);
        res.status(500).send("Database connection failed.");
    }
});

app.get("/", (req, res) => {
    res.sendFile(path.join(publicPath, "login.html"));
});

app.get("/dashboard", requireLogin, (req, res) => {
    res.sendFile(dashboardPath);
});

app.get("/index.html", requireLogin, (req, res) => {
    res.redirect("/dashboard");
});

app.post("/api/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ message: "Please fill in all fields." });
        }

        const cleanName = name.trim();
        const cleanEmail = email.trim().toLowerCase();

        if (!cleanName || !cleanEmail || password.length < 8) {
            return res.status(400).json({
                message: "Enter valid details. Password must have at least 8 characters."
            });
        }

        const existing = await pool.query(
            "SELECT id FROM users WHERE email = $1",
            [cleanEmail]
        );

        if (existing.rows.length) {
            return res.status(409).json({
                message: "An account with this email already exists."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const result = await pool.query(
            `INSERT INTO users (name, email, password)
             VALUES ($1, $2, $3)
             RETURNING id, name, email`,
            [cleanName, cleanEmail, hashedPassword]
        );

        req.session.user = result.rows[0];

        res.status(201).json({
            message: "Account created successfully!",
            user: result.rows[0]
        });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ message: "Could not create your account." });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Enter your email and password."
            });
        }

        const result = await pool.query(
            "SELECT * FROM users WHERE email = $1",
            [email.trim().toLowerCase()]
        );

        if (!result.rows.length) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const user = result.rows[0];
        const matches = await bcrypt.compare(password, user.password);

        if (!matches) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        req.session.user = {
            id: user.id,
            name: user.name,
            email: user.email
        };

        res.json({ message: "Login successful!", user: req.session.user });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: "Could not login." });
    }
});

app.get("/api/me", (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ message: "Please login." });
    }
    res.json({ user: req.session.user });
});

app.post("/api/logout", (req, res) => {
    req.session.destroy(error => {
        if (error) {
            return res.status(500).json({ message: "Could not logout." });
        }
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out successfully." });
    });
});

app.get("/api/tasks", requireLogin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, title, description, status, due_date, created_at
             FROM tasks WHERE user_id = $1
             ORDER BY created_at DESC`,
            [req.session.user.id]
        );
        res.json({ tasks: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not load tasks." });
    }
});

app.post("/api/tasks", requireLogin, async (req, res) => {
    try {
        const { title, description = "", due_date = null } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({ message: "Task title is required." });
        }

        const result = await pool.query(
            `INSERT INTO tasks (user_id, title, description, due_date)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [req.session.user.id, title.trim(), description, due_date || null]
        );

        res.status(201).json({
            message: "Task added successfully!",
            task: result.rows[0]
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not add task." });
    }
});

app.patch("/api/tasks/:id", requireLogin, async (req, res) => {
    try {
        const { title, description, status, due_date } = req.body;

        if (status !== undefined && !["pending", "completed"].includes(status)) {
            return res.status(400).json({ message: "Invalid task status." });
        }

        const result = await pool.query(
            `UPDATE tasks SET
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                status = COALESCE($3, status),
                due_date = CASE WHEN $4::boolean THEN $5::date ELSE due_date END
             WHERE id = $6 AND user_id = $7
             RETURNING *`,
            [
                title === undefined ? null : title.trim(),
                description === undefined ? null : description,
                status === undefined ? null : status,
                due_date !== undefined,
                due_date || null,
                req.params.id,
                req.session.user.id
            ]
        );

        if (!result.rows.length) {
            return res.status(404).json({ message: "Task not found." });
        }

        res.json({ message: "Task updated successfully!", task: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not update task." });
    }
});

app.delete("/api/tasks/:id", requireLogin, async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id`,
            [req.params.id, req.session.user.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ message: "Task not found." });
        }

        res.json({ message: "Task deleted successfully." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not delete task." });
    }
});

app.use(express.static(publicPath, { index: false }));

app.use("/api", (req, res) => {
    res.status(404).json({ message: "API route not found." });
});

module.exports = app;

if (require.main === module) {
    if (!process.env.SESSION_SECRET) {
        console.error("SESSION_SECRET is missing.");
        process.exit(1);
    }

    app.listen(PORT, () => {
        console.log(`TaskMate running at http://localhost:${PORT}`);
    });
}
