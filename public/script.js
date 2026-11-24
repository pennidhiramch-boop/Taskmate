document.addEventListener("DOMContentLoaded", () => {
    const $ = (id) => document.getElementById(id);

    const taskForm = $("taskForm");
    const taskInput = $("taskInput");
    const taskDueDate = $("taskDueDate");
    const taskList = $("taskList");
    const emptyState = $("emptyState");

    const themeToggle = $("themeToggle");
    const profileButton = $("profileButton");
    const profileMenu = $("profileMenu");
    const logoutButton = $("logoutButton");

    let tasks = [];
    let currentFilter = "all";

    // API helper
    async function api(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...options.headers
            }
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
            window.location.replace("/");
            throw new Error("Please login again.");
        }

        if (!response.ok) {
            throw new Error(data.message || "Something went wrong.");
        }

        return data;
    }

    function initials(name) {
        return name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map(part => part[0].toUpperCase())
            .join("");
    }

    // Load student profile
    async function loadProfile() {
        try {
            const data = await api("/api/me");
            const user = data.user;

            $("sidebarUserName").textContent = user.name;
            $("sidebarAvatar").textContent = initials(user.name);
            $("welcomeUserName").textContent = user.name.split(/\s+/)[0];

            profileButton.textContent = initials(user.name);
            $("menuAvatar").textContent = initials(user.name);
            $("menuUserName").textContent = user.name;
            $("menuUserEmail").textContent = user.email;

            return true;
        } catch (error) {
            console.error("Profile error:", error);
            return false;
        }
    }

    // Format dates
    function formatDate(dateValue) {
        if (!dateValue) return "No due date";

        const date = new Date(dateValue + "T00:00:00");

        if (Number.isNaN(date.getTime())) return "No due date";

        return date.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric"
        });
    }

    // Update dashboard statistics
    function updateStatistics() {
        const total = tasks.length;
        const completed = tasks.filter(
            task => task.status === "completed"
        ).length;
        const pending = total - completed;

        const progress = total === 0
            ? 0
            : Math.round((completed / total) * 100);

        $("totalCount").textContent = total;
        $("pendingCount").textContent = pending;
        $("completedCount").textContent = completed;
        $("progressCount").textContent = progress + "%";
        $("pendingNavCount").textContent = pending;

        $("taskTotalLabel").textContent =
            total + (total === 1 ? " task" : " tasks");
    }

    // Create task card
    function createTaskCard(task) {
        const completed = task.status === "completed";

        const card = document.createElement("article");
        card.className = completed
            ? "task-card completed"
            : "task-card pending";

        const indicator = document.createElement("div");
        indicator.className = "task-indicator";

        const details = document.createElement("div");
        details.className = "task-details";

        const name = document.createElement("div");
        name.className = "task-name";
        name.textContent = task.title;

        const date = document.createElement("div");
        date.className = "task-date";
        date.textContent = task.due_date
            ? "Due " + formatDate(task.due_date)
            : "No due date";

        details.append(name, date);

        const badge = document.createElement("span");
        badge.className = "status-badge";
        badge.textContent = completed ? "Completed" : "Pending";

        const actions = document.createElement("div");
        actions.className = "task-actions";

        // Complete / reopen
        const completeButton = document.createElement("button");
        completeButton.type = "button";
        completeButton.className = "task-action complete-action";
        completeButton.title = completed
            ? "Mark as pending"
            : "Mark as completed";

        const completeIcon = document.createElement("i");
        completeIcon.className = completed
            ? "fa-solid fa-rotate-left"
            : "fa-solid fa-check";

        completeButton.appendChild(completeIcon);

        completeButton.addEventListener("click", () => {
            updateTask(task.id, {
                status: completed ? "pending" : "completed",
                due_date: task.due_date || null
            });
        });

        // Edit task
        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "task-action";
        editButton.title = "Edit task";

        const editIcon = document.createElement("i");
        editIcon.className = "fa-solid fa-pen";
        editButton.appendChild(editIcon);

        editButton.addEventListener("click", async () => {
            const updatedTitle = prompt("Edit your task:", task.title);

            if (updatedTitle === null) return;

            if (!updatedTitle.trim()) {
                alert("Task title cannot be empty.");
                return;
            }

            const updatedDescription = prompt(
                "Edit task description:",
                task.description || ""
            );

            if (updatedDescription === null) return;

            await updateTask(task.id, {
                title: updatedTitle.trim(),
                description: updatedDescription,
                due_date: task.due_date || null
            });
        });

        // Delete task
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "task-action delete-action";
        deleteButton.title = "Delete task";

        const deleteIcon = document.createElement("i");
        deleteIcon.className = "fa-solid fa-trash";
        deleteButton.appendChild(deleteIcon);

        deleteButton.addEventListener("click", () => {
            deleteTask(task.id);
        });

        actions.append(
            completeButton,
            editButton,
            deleteButton
        );

        card.append(
            indicator,
            details,
            badge,
            actions
        );

        return card;
    }

    // Render task list
    function renderTasks() {
        updateStatistics();
        taskList.replaceChildren();

        const filteredTasks = tasks.filter(task => {
            if (currentFilter === "pending") {
                return task.status === "pending";
            }

            if (currentFilter === "completed") {
                return task.status === "completed";
            }

            return true;
        });

        if (filteredTasks.length === 0) {
            emptyState.style.display = "block";

            const title = emptyState.querySelector("h3");
            const message = emptyState.querySelector("p");

            if (tasks.length === 0) {
                title.textContent = "Your workspace is clear!";
                message.textContent =
                    "Add your first task and start making progress.";
            } else if (currentFilter === "pending") {
                title.textContent = "No pending tasks!";
                message.textContent =
                    "You've completed everything in this list.";
            } else {
                title.textContent = "Nothing completed yet.";
                message.textContent =
                    "Complete a task and it will appear here.";
            }

            return;
        }

        emptyState.style.display = "none";

        filteredTasks.forEach(task => {
            taskList.appendChild(createTaskCard(task));
        });
    }

    // Load tasks from PostgreSQL
    async function loadTasks() {
        try {
            const data = await api("/api/tasks");
            tasks = data.tasks || [];
            renderTasks();
        } catch (error) {
            console.error("Load tasks error:", error);
            alert(error.message);
        }
    }

    // Add task
    taskForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const title = taskInput.value.trim();

        if (!title) {
            taskInput.focus();
            return;
        }

        const button = taskForm.querySelector("button[type='submit']");
        button.disabled = true;

        try {
            await api("/api/tasks", {
                method: "POST",
                body: JSON.stringify({
                    title,
                    due_date: taskDueDate.value || null
                })
            });

            taskInput.value = "";
            taskDueDate.value = "";
            currentFilter = "all";
            updateActiveFilters();
            await loadTasks();
            taskInput.focus();

        } catch (error) {
            alert(error.message);
        } finally {
            button.disabled = false;
        }
    });

    // Update task
    async function updateTask(id, changes) {
        try {
            await api(`/api/tasks/${id}`, {
                method: "PATCH",
                body: JSON.stringify(changes)
            });

            await loadTasks();
        } catch (error) {
            alert(error.message);
        }
    }

    // Delete task
    async function deleteTask(id) {
        if (!confirm("Are you sure you want to delete this task?")) {
            return;
        }

        try {
            await api(`/api/tasks/${id}`, {
                method: "DELETE"
            });

            await loadTasks();
        } catch (error) {
            alert(error.message);
        }
    }

    // Task filters
    function updateActiveFilters() {
        document.querySelectorAll("[data-filter]").forEach(button => {
            button.classList.toggle(
                "active",
                button.dataset.filter === currentFilter
            );
        });
    }

    document.querySelectorAll("[data-filter]").forEach(button => {
        button.addEventListener("click", () => {
            currentFilter = button.dataset.filter;
            updateActiveFilters();
            renderTasks();
        });
    });

    // Theme
    function applyTheme(theme) {
        document.documentElement.dataset.theme = theme;

        const icon = themeToggle.querySelector("i");

        if (theme === "dark") {
            icon.className = "fa-solid fa-sun";
            themeToggle.title = "Switch to light mode";
        } else {
            icon.className = "fa-solid fa-moon";
            themeToggle.title = "Switch to dark mode";
        }

        try {
            localStorage.setItem("taskmate_theme", theme);
        } catch (error) {
            console.error("Theme preference could not be saved.");
        }
    }

    let savedTheme = "light";

    try {
        savedTheme = localStorage.getItem("taskmate_theme") || "light";
    } catch (error) {
        console.error("Theme preference could not be loaded.");
    }

    applyTheme(savedTheme === "dark" ? "dark" : "light");

    themeToggle.addEventListener("click", () => {
        const currentTheme = document.documentElement.dataset.theme;
        applyTheme(currentTheme === "dark" ? "light" : "dark");
    });

    // Profile menu
    profileButton.addEventListener("click", (event) => {
        event.stopPropagation();

        profileMenu.hidden = !profileMenu.hidden;

        profileButton.setAttribute(
            "aria-expanded",
            String(!profileMenu.hidden)
        );
    });

    document.addEventListener("click", (event) => {
        if (
            !profileMenu.contains(event.target) &&
            !profileButton.contains(event.target)
        ) {
            profileMenu.hidden = true;
            profileButton.setAttribute("aria-expanded", "false");
        }
    });

    // Logout
    logoutButton.addEventListener("click", async () => {
        logoutButton.disabled = true;

        try {
            await api("/api/logout", {
                method: "POST"
            });

            window.location.replace("/");
        } catch (error) {
            alert(error.message);
            logoutButton.disabled = false;
        }
    });

    // Today's date
    $("todayDate").textContent = new Date().toLocaleDateString(
        "en-IN",
        {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
        }
    );

    // Start application
    async function initialize() {
        const profileLoaded = await loadProfile();

        if (profileLoaded) {
            await loadTasks();
        }
    }

    initialize();
});