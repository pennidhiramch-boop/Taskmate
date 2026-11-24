
require("dotenv").config();

const express = require("express");
const path = require("path");
const bcrypt = require("bcrypt");
const session = require("express-session");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const publicPath = path.join(__dirname, "public");

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log API requests to the terminal
app.use((req, res, next) => {
    if (req.originalUrl.startsWith("/api")) {
        console.log("API REQUEST:", req.method, req.originalUrl);
    }
    next();
});

// Session configuration
app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: false,
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    })
);

// Login protection
function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            message: "Please login to continue."
        });
    }

    next();
}

// Create database tables
async function initializeDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS tasks (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL
                REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            description TEXT DEFAULT '',
            status VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'completed')),
            due_date DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);

    console.log("Database tables ready!");
}

// Home page
app.get("/", (req, res) => {
    res.sendFile(path.join(publicPath, "login.html"));
});

// Dashboard
app.get("/dashboard", requireLogin, (req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
});

app.get("/index.html", requireLogin, (req, res) => {
    res.redirect("/dashboard");
});

// Register
app.post("/api/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                message: "Please fill in all fields."
            });
        }

        const cleanName = name.trim();
        const cleanEmail = email.trim().toLowerCase();

        if (!cleanName || !cleanEmail || password.length < 8) {
            return res.status(400).json({
                message: "Enter valid details. Password must have at least 8 characters."
            });
        }

        const existingUser = await pool.query(
            "SELECT id FROM users WHERE email = $1",
            [cleanEmail]
        );

        if (existingUser.rows.length > 0) {
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

        res.status(500).json({
            message: "Could not create your account."
        });
    }
});

// Login
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

        if (result.rows.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const user = result.rows[0];

        const passwordMatches = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatches) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        req.session.user = {
            id: user.id,
            name: user.name,
            email: user.email
        };

        res.json({
            message: "Login successful!",
            user: req.session.user
        });

    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            message: "Could not login."
        });
    }
});

// Get logged-in user
app.get("/api/me", requireLogin, (req, res) => {
    res.json({
        user: req.session.user
    });
});

// Logout
app.post("/api/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.error("Logout error:", error);

            return res.status(500).json({
                message: "Could not logout."
            });
        }

        res.clearCookie("connect.sid");

        res.json({
            message: "Logged out successfully."
        });
    });
});

// Get tasks belonging to logged-in user
app.get("/api/tasks", requireLogin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, title, description, status, due_date, created_at
             FROM tasks
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [req.session.user.id]
        );

        res.json({
            tasks: result.rows
        });

    } catch (error) {
        console.error("Get tasks error:", error);

        res.status(500).json({
            message: "Could not load tasks."
        });
    }
});

// Add task
app.post("/api/tasks", requireLogin, async (req, res) => {
    try {
        const { title, description = "", due_date = null } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({
                message: "Task title is required."
            });
        }

        const result = await pool.query(
            `INSERT INTO tasks
                (user_id, title, description, due_date)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [
                req.session.user.id,
                title.trim(),
                description,
                due_date || null
            ]
        );

        res.status(201).json({
            message: "Task added successfully!",
            task: result.rows[0]
        });

    } catch (error) {
        console.error("Add task error:", error);

        res.status(500).json({
            message: "Could not add task."
        });
    }
});

// Update task
app.patch("/api/tasks/:id", requireLogin, async (req, res) => {
    try {
        const { title, description, status, due_date } = req.body;

        if (
            status !== undefined &&
            !["pending", "completed"].includes(status)
        ) {
            return res.status(400).json({
                message: "Invalid task status."
            });
        }

        const result = await pool.query(
            `UPDATE tasks
             SET
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                status = COALESCE($3, status),
                due_date = CASE
                    WHEN $4::boolean THEN $5::date
                    ELSE due_date
                END
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

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "Task not found."
            });
        }

        res.json({
            message: "Task updated successfully!",
            task: result.rows[0]
        });

    } catch (error) {
        console.error("Update task error:", error);

        res.status(500).json({
            message: "Could not update task."
        });
    }
});

// Delete task
app.delete("/api/tasks/:id", requireLogin, async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM tasks
             WHERE id = $1 AND user_id = $2
             RETURNING id`,
            [req.params.id, req.session.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: "Task not found."
            });
        }

        res.json({
            message: "Task deleted successfully."
        });

    } catch (error) {
        console.error("Delete task error:", error);

        res.status(500).json({
            message: "Could not delete task."
        });
    }
});

// Serve frontend files
app.use(express.static(publicPath, {
    index: false
}));

// Handle unknown API routes
app.use("/api", (req, res) => {
    console.log("UNMATCHED API:", req.method, req.originalUrl);

    res.status(404).json({
        message: "API route not found."
    });
});

// Start server
async function startServer() {
    try {
        if (!process.env.SESSION_SECRET) {
            throw new Error("SESSION_SECRET is missing from .env");
        }

        await initializeDatabase();

        app.listen(PORT, () => {
            console.log(`TaskMate running at http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error("Server startup failed:", error);
        process.exit(1);
    }
}

startServer();
