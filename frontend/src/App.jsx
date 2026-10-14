
import { useEffect, useState } from "react";
import { api, logout } from "./api";

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [user, setUser] = useState(
    JSON.parse(localStorage.getItem("user") || "null")
  );
  const [mode, setMode] = useState("login");
  const [message, setMessage] = useState("");
  const [profile, setProfile] = useState({});
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: ""
  });

  function updateForm(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  async function submitAuth(event) {
    event.preventDefault();
    setMessage("");

    try {
      const endpoint =
        mode === "register" ? "/api/auth/register" : "/api/auth/login";

      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(form)
      });

      if (result.token) {
        localStorage.setItem("token", result.token);
        localStorage.setItem("user", JSON.stringify(result.user));
        setToken(result.token);
        setUser(result.user);
      } else {
        setMessage("Account created. Please log in.");
        setMode("login");
      }
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadProfile() {
    try {
      const result = await api("/api/users/me");
      setProfile(result.profile || {});
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    try {
      await api("/api/users/me", {
        method: "PUT",
        body: JSON.stringify(profile)
      });
      setMessage("Profile saved.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadUsers() {
    try {
      const result = await api("/api/admin/users");
      setUsers(result.users || []);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function updateUserRole(id, role) {
    try {
      await api(`/api/admin/users/${id}`, {
        method: "PUT",
        body: JSON.stringify({ role })
      });
      await loadUsers();
      setMessage("User role updated.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function deleteUser(id) {
    if (!window.confirm("Delete this user?")) return;

    try {
      await api(`/api/admin/users/${id}`, { method: "DELETE" });
      await loadUsers();
      setMessage("User deleted.");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function uploadFile(event) {
    event.preventDefault();
    const file = event.target.elements.file.files[0];
    if (!file) return;

    try {
      const result = await api("/api/files/upload-url", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size
        })
      });

      const upload = await fetch(result.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });

      if (!upload.ok) throw new Error("S3 upload failed.");
      setMessage(`Uploaded ${file.name} successfully.`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  useEffect(() => {
    if (!token) return;
    loadProfile();
  }, [token]);

  useEffect(() => {
    if (token && user?.role === "admin") loadUsers();
  }, [token, user?.role]);

  function signOut() {
    logout();
    setToken(null);
    setUser(null);
    setProfile({});
    setUsers([]);
    setMessage("You have logged out.");
  }

  if (!token) {
    return (
      <main className="auth-page">
        <form className="panel auth-panel" onSubmit={submitAuth}>
          <h1>AWS Full Stack App</h1>
          <p>React frontend · Node.js microservices · AWS</p>
          <div className="tabs">
            <button type="button" onClick={() => setMode("login")}>
              Login
            </button>
            <button type="button" onClick={() => setMode("register")}>
              Register
            </button>
          </div>

          {mode === "register" && (
            <label>
              Full name
              <input
                name="name"
                value={form.name}
                onChange={updateForm}
                required
              />
            </label>
          )}

          <label>
            Email
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={updateForm}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={updateForm}
              minLength={12}
              required
            />
          </label>

          <button className="primary" type="submit">
            {mode === "register" ? "Create account" : "Login"}
          </button>
          <p className="message">{message}</p>
        </form>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <h1>Dashboard</h1>
          <span>{user?.email} · {user?.role}</span>
        </div>
        <button onClick={signOut}>Logout</button>
      </header>

      <p className="message">{message}</p>

      <section className="panel">
        <h2>My profile</h2>
        <form onSubmit={saveProfile}>
          <label>
            Display name
            <input
              value={profile.displayName || ""}
              onChange={(e) =>
                setProfile({ ...profile, displayName: e.target.value })
              }
            />
          </label>
          <label>
            Phone
            <input
              value={profile.phone || ""}
              onChange={(e) =>
                setProfile({ ...profile, phone: e.target.value })
              }
            />
          </label>
          <label>
            About me
            <textarea
              value={profile.about || ""}
              onChange={(e) =>
                setProfile({ ...profile, about: e.target.value })
              }
            />
          </label>
          <button className="primary">Save profile</button>
        </form>
      </section>

      <section className="panel">
        <h2>Upload a file to S3</h2>
        <form onSubmit={uploadFile}>
          <label>
            Select a file
            <input name="file" type="file" required />
          </label>
          <button className="primary">Upload file</button>
        </form>
      </section>

      {user?.role === "admin" && (
        <section className="panel">
          <h2>Admin · User management</h2>
          <button onClick={loadUsers}>Refresh users</button>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.name}</td>
                    <td>{item.email}</td>
                    <td>{item.role}</td>
                    <td className="actions">
                      <button
                        onClick={() =>
                          updateUserRole(
                            item.id,
                            item.role === "admin" ? "user" : "admin"
                          )
                        }
                      >
                        Toggle role
                      </button>
                      {item.id !== user.id && (
                        <button
                          className="danger"
                          onClick={() => deleteUser(item.id)}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
