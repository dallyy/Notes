#include <httplib.h>
#include "json.hpp"

#include <fstream>
#include <filesystem>
#include <iostream>
#include <unistd.h>
#include <chrono>
#include <random>
#include <sstream>
#include <iomanip>
#include <ctime>
#include <algorithm>
#include <cstdio>
#include <cctype>
#include <mutex>
#include <thread>
#include <string>
#include <vector>

namespace fs = std::filesystem;
using json = nlohmann::json;

// ── limits ───────────────────────────────────────────────────
constexpr size_t MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MiB background images
constexpr size_t MAX_NOTE_CONTENT = 2 * 1024 * 1024;  // 2 MiB per note body
constexpr size_t MAX_NOTE_TITLE   = 512;              // bytes per note title
constexpr size_t MAX_THEME_LEN    = 32;

// ── paths ────────────────────────────────────────────────────
fs::path BASE_DIR;

fs::path data_dir()      { return BASE_DIR / "data"; }
fs::path uploads_dir()   { return BASE_DIR / "uploads"; }
fs::path notes_path()    { return data_dir() / "notes.json"; }
fs::path settings_path() { return data_dir() / "settings.json"; }
fs::path folders_path()  { return data_dir() / "folders.json"; }

// ── concurrency ──────────────────────────────────────────────
// httplib serves each request on a worker thread. All data access is
// serialized through this mutex: every read-modify-write cycle is
// atomic in-process, and locking readers too means a concurrent file
// replacement can never leave a torn write visible.
std::mutex data_mutex;

// ── helpers ──────────────────────────────────────────────────

std::string uuid_hex() {
    static std::random_device rd;
    static std::mt19937_64 gen(rd());
    static std::uniform_int_distribution<uint64_t> dis;
    uint64_t a = dis(gen), b = dis(gen);
    char buf[33];
    snprintf(buf, sizeof(buf), "%016llx%016llx",
             (unsigned long long)a, (unsigned long long)b);
    return buf;
}

std::string now_iso() {
    auto now = std::chrono::system_clock::now();
    auto t = std::chrono::system_clock::to_time_t(now);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()) % 1000;
    std::tm gmt;
    gmtime_r(&t, &gmt);
    std::ostringstream ss;
    ss << std::put_time(&gmt, "%Y-%m-%dT%H:%M:%S");
    ss << "." << std::setfill('0') << std::setw(3) << ms.count();
    ss << "+00:00";
    return ss.str();
}

// Read JSON with a short retry for robustness against transient I/O
// issues during a concurrent atomic rename.
json read_json(const fs::path& path, const json& def) {
    if (!fs::exists(path)) return def;
    for (int attempt = 0; attempt < 3; ++attempt) {
        std::ifstream f(path, std::ios::binary);
        if (f.is_open()) {
            json j = json::parse(f, nullptr, false);
            return j.is_discarded() ? def : j;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    return def;
}

// Atomic persist: write a temp file, then replace the target in one
// step. A reader always sees either the complete old or new file —
// never a torn write, even if the process dies mid-save.
bool write_file_atomic(const fs::path& path, const std::string& content) {
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    if (ec) return false;

    fs::path tmp = path;
    tmp += ".tmp";
    {
        std::ofstream f(tmp, std::ios::binary | std::ios::trunc);
        if (!f.is_open()) return false;
        f.write(content.data(), (std::streamsize)content.size());
        f.flush();
        if (!f.good()) {
            f.close();
            fs::remove(tmp, ec);
            return false;
        }
    }
    fs::rename(tmp, path, ec);
    return !ec;
}

json default_settings() {
    return {{"background_image", nullptr}, {"blur", 0},
            {"transparency", 1.0}, {"theme", "cyan"}};
}

json default_folders() {
    return {{"folders", json::array()}, {"note_folder", json::object()}};
}

json load_notes() { return read_json(notes_path(), json::array()); }
json load_settings() { return read_json(settings_path(), default_settings()); }
json load_folders() { return read_json(folders_path(), default_folders()); }

bool save_notes(const json& n) { return write_file_atomic(notes_path(), n.dump(2)); }
bool save_settings(const json& s) { return write_file_atomic(settings_path(), s.dump(2)); }
bool save_folders(const json& f) { return write_file_atomic(folders_path(), f.dump(2)); }

// ── title normalization (mirror of frontend normTitle) ────────
// Keep only [0-9A-Za-z一-鿿], lower-case ASCII. UTF-8 aware.
std::string norm_title(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    size_t i = 0, n = s.size();
    while (i < n) {
        unsigned char c = (unsigned char)s[i];
        uint32_t cp = 0;
        size_t len = 0;
        if (c < 0x80) { cp = c; len = 1; }
        else if ((c & 0xE0) == 0xC0 && i + 1 < n) { cp = c & 0x1F; len = 2; }
        else if ((c & 0xF0) == 0xE0 && i + 2 < n) { cp = c & 0x0F; len = 3; }
        else if ((c & 0xF8) == 0xF0 && i + 3 < n) { cp = c & 0x07; len = 4; }
        else { ++i; continue; } // stray byte, skip
        for (size_t k = 1; k < len; ++k)
            cp = (cp << 6) | ((unsigned char)s[i + k] & 0x3F);

        bool keep = (cp >= '0' && cp <= '9') ||
                    (cp >= 'A' && cp <= 'Z') ||
                    (cp >= 'a' && cp <= 'z') ||
                    (cp >= 0x4E00 && cp <= 0x9FFF);
        if (keep) {
            if (cp >= 'A' && cp <= 'Z') cp += ('a' - 'A');
            if (cp < 0x80) {
                out += (char)cp;
            } else if (cp < 0x800) {
                out += (char)(0xC0 | (cp >> 6));
                out += (char)(0x80 | (cp & 0x3F));
            } else {
                out += (char)(0xE0 | (cp >> 12));
                out += (char)(0x80 | ((cp >> 6) & 0x3F));
                out += (char)(0x80 | (cp & 0x3F));
            }
        }
        i += len;
    }
    return out;
}

// ── wiki-link maintenance ────────────────────────────────────
// Rewrite [[OldTitle#sec|alias]]-style links to use new_title.
// Skipped inside ``` fenced blocks and `inline code`, mirroring the
// frontend renderer's code protection.
std::string rewrite_wiki_links(const std::string& text,
                               const std::string& norm_old,
                               const std::string& new_title,
                               bool& changed) {
    changed = false;
    std::string out;
    out.reserve(text.size() + 32);
    size_t pos = 0, n = text.size();
    bool in_fence = false, in_code = false;

    while (pos < n) {
        char ch = text[pos];
        if (ch == '`') {
            size_t end = pos;
            while (end < n && text[end] == '`') ++end;
            size_t run = end - pos;
            if (run == 1) in_code = !in_code;
            else if (run >= 3) in_fence = !in_fence;
            out.append(text, pos, run);
            pos = end;
            continue;
        }
        if (ch == '[' && !in_fence && !in_code &&
            pos + 1 < n && text[pos + 1] == '[') {
            size_t close = text.find("]]", pos + 2);
            if (close != std::string::npos && close > pos + 2) {
                std::string inner = text.substr(pos + 2, close - pos - 2);
                std::string title_part = inner, alias_part;
                size_t pipe = inner.find('|');
                if (pipe != std::string::npos) {
                    title_part = inner.substr(0, pipe);
                    alias_part = inner.substr(pipe + 1);
                }
                std::string base = title_part;
                size_t hash = title_part.find('#');
                if (hash != std::string::npos) base = title_part.substr(0, hash);

                if (!base.empty() && norm_title(base) == norm_old) {
                    out += "[[" + new_title;
                    if (hash != std::string::npos) out += title_part.substr(hash);
                    if (pipe != std::string::npos) out += "|" + alias_part;
                    out += "]]";
                    pos = close + 2;
                    changed = true;
                    continue;
                }
            }
        }
        out += ch;
        ++pos;
    }
    return out;
}

// ── upload validation ────────────────────────────────────────
// Extension is derived from magic bytes, never from the client
// filename — the stored name is always "bg_<uuid><ext>".
bool sniff_image_ext(const std::string& data, std::string& ext) {
    auto has = [](const std::string& d, size_t off,
                  std::initializer_list<unsigned char> sig) {
        if (d.size() < off + sig.size()) return false;
        size_t i = 0;
        for (unsigned char b : sig)
            if ((unsigned char)d[off + i++] != b) return false;
        return true;
    };
    if (has(data, 0, {0xFF, 0xD8, 0xFF})) { ext = ".jpg"; return true; }
    if (has(data, 0, {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A})) { ext = ".png"; return true; }
    if (has(data, 0, {'G', 'I', 'F', '8'})) { ext = ".gif"; return true; }
    if (has(data, 0, {'R', 'I', 'F', 'F'}) && has(data, 8, {'W', 'E', 'B', 'P'})) { ext = ".webp"; return true; }
    return false;
}

const std::vector<std::string> ALLOWED_THEMES =
    {"cyan", "emerald", "violet", "rose", "amber"};

// ── main ─────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    // Determine base directory from the real executable path. On Linux,
    // argv[0] is not guaranteed to point at the binary when it is launched
    // through PATH or a symlink, so resolve /proc/self/exe when possible.
    fs::path exe;
    char exe_buf[4096];
    ssize_t exe_len = readlink("/proc/self/exe", exe_buf, sizeof(exe_buf) - 1);
    if (exe_len != -1) {
        exe_buf[exe_len] = '\0';
        exe = fs::path(exe_buf);
    } else {
        exe = fs::absolute(fs::path(argv[0]));
    }
    BASE_DIR = exe.parent_path();

    // Ensure data directories exist
    fs::create_directories(data_dir());
    fs::create_directories(uploads_dir());

    httplib::Server svr;
    svr.set_payload_max_length(MAX_UPLOAD_BYTES);

    // ── page ──────────────────────────────────────────────
    svr.Get("/", [](const httplib::Request&, httplib::Response& res) {
        // The shell changes often (script tags, vendor paths) — never let
        // the browser serve a stale cached copy.
        res.set_header("Cache-Control", "no-cache");
        auto path = BASE_DIR / "templates" / "index.html";
        if (fs::exists(path)) {
            std::ifstream f(path, std::ios::binary);
            std::string content((std::istreambuf_iterator<char>(f)),
                                 std::istreambuf_iterator<char>());
            res.set_content(content, "text/html; charset=utf-8");
        } else {
            res.status = 404;
        }
    });

    // ── static files ──────────────────────────────────────
    svr.set_mount_point("/static", (BASE_DIR / "static").string());
    svr.set_mount_point("/uploads", uploads_dir().string());

    // ── notes api ─────────────────────────────────────────
    svr.Get("/api/notes", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(data_mutex);
        json notes = load_notes();
        res.set_content(notes.dump(), "application/json");
    });

    svr.Post("/api/notes", [](const httplib::Request& req, httplib::Response& res) {
        json body;
        try { body = json::parse(req.body); }
        catch (...) {
            res.status = 400;
            res.set_content(R"({"detail":"Invalid JSON body"})", "application/json");
            return;
        }
        std::string title, content;
        try {
            title = body.value("title", "");
            content = body.value("content", "");
        } catch (...) {
            res.status = 400;
            res.set_content(R"({"detail":"title/content must be strings"})", "application/json");
            return;
        }
        if (title.size() > MAX_NOTE_TITLE) {
            res.status = 400;
            res.set_content(R"({"detail":"Title too long"})", "application/json");
            return;
        }
        if (content.size() > MAX_NOTE_CONTENT) {
            res.status = 413;
            res.set_content(R"({"detail":"Content too large"})", "application/json");
            return;
        }

        std::lock_guard<std::mutex> lock(data_mutex);
        json notes = load_notes();
        json note;
        note["id"] = uuid_hex();
        note["title"] = title;
        note["content"] = content;
        note["created_at"] = now_iso();
        note["updated_at"] = note["created_at"];
        notes.push_back(note);
        if (!save_notes(notes)) {
            res.status = 500;
            res.set_content(R"({"detail":"Failed to persist notes"})", "application/json");
            return;
        }
        res.set_content(note.dump(), "application/json");
    });

    svr.Put(R"(/api/notes/([a-f0-9]+))", [](const httplib::Request& req, httplib::Response& res) {
        std::string note_id = req.matches[1];
        json body;
        try { body = json::parse(req.body); }
        catch (...) {
            res.status = 400;
            res.set_content(R"({"detail":"Invalid JSON body"})", "application/json");
            return;
        }
        std::string new_title;
        std::string new_content;
        try {
            if (body.contains("title")) new_title = body["title"].get<std::string>();
            if (body.contains("content")) new_content = body["content"].get<std::string>();
        } catch (...) {
            res.status = 400;
            res.set_content(R"({"detail":"title/content must be strings"})", "application/json");
            return;
        }
        if (new_title.size() > MAX_NOTE_TITLE) {
            res.status = 400;
            res.set_content(R"({"detail":"Title too long"})", "application/json");
            return;
        }
        if (new_content.size() > MAX_NOTE_CONTENT) {
            res.status = 413;
            res.set_content(R"({"detail":"Content too large"})", "application/json");
            return;
        }

        std::lock_guard<std::mutex> lock(data_mutex);
        json notes = load_notes();
        for (auto& n : notes) {
            if (n["id"] == note_id) {
                std::string old_title = n.value("title", "");
                if (body.contains("title")) n["title"] = new_title;
                if (body.contains("content")) n["content"] = new_content;
                n["updated_at"] = now_iso();

                // ── rename maintenance: keep [[wiki links]] pointing at this note ──
                std::string applied_title = n.value("title", "");
                std::string norm_old = norm_title(old_title);
                std::string norm_new = norm_title(applied_title);
                if (!norm_old.empty() && !applied_title.empty() &&
                    norm_old != norm_new) {
                    // Only rewrite when the old title is unambiguous: after
                    // applying the rename, no other note carries it.
                    size_t other_holders = 0;
                    for (const auto& m : notes)
                        if (norm_title(m.value("title", "")) == norm_old) other_holders++;
                    if (other_holders == 0) {
                        for (auto& m : notes) {
                            std::string c = m.value("content", "");
                            bool changed = false;
                            std::string nc = rewrite_wiki_links(c, norm_old, applied_title, changed);
                            if (changed) {
                                m["content"] = nc;
                                m["updated_at"] = now_iso();
                            }
                        }
                    }
                }

                if (!save_notes(notes)) {
                    res.status = 500;
                    res.set_content(R"({"detail":"Failed to persist notes"})", "application/json");
                    return;
                }
                res.set_content(n.dump(), "application/json");
                return;
            }
        }
        res.status = 404;
        res.set_content(R"({"detail":"Note not found"})", "application/json");
    });

    svr.Delete(R"(/api/notes/([a-f0-9]+))", [](const httplib::Request& req, httplib::Response& res) {
        std::string note_id = req.matches[1];

        std::lock_guard<std::mutex> lock(data_mutex);
        json notes = load_notes();
        size_t before = notes.size();
        json filtered = json::array();
        for (const auto& n : notes) {
            if (n["id"] != note_id) filtered.push_back(n);
        }
        if (filtered.size() == before) {
            res.status = 404;
            res.set_content(R"({"detail":"Note not found"})", "application/json");
            return;
        }
        if (!save_notes(filtered)) {
            res.status = 500;
            res.set_content(R"({"detail":"Failed to persist notes"})", "application/json");
            return;
        }
        res.set_content(R"({"ok":true})", "application/json");
    });

    // ── folders api ──────────────────────────────────────
    // Folders are UI state, but persisting them on the server keeps them
    // available across browsers / OS reinstalls (unlike localStorage).
    svr.Get("/api/folders", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(data_mutex);
        res.set_content(load_folders().dump(), "application/json");
    });

    svr.Put("/api/folders", [](const httplib::Request& req, httplib::Response& res) {
        json body;
        try { body = json::parse(req.body); }
        catch (...) {
            res.status = 400;
            res.set_content(R"({"detail":"Invalid JSON body"})", "application/json");
            return;
        }
        if (!body.contains("folders") || !body["folders"].is_array() ||
            !body.contains("note_folder") || !body["note_folder"].is_object()) {
            res.status = 400;
            res.set_content(R"({"detail":"folders must be an array and note_folder an object"})", "application/json");
            return;
        }

        std::lock_guard<std::mutex> lock(data_mutex);
        if (!save_folders(body)) {
            res.status = 500;
            res.set_content(R"({"detail":"Failed to persist folders"})", "application/json");
            return;
        }
        res.set_content(body.dump(), "application/json");
    });

    // ── settings api ──────────────────────────────────────
    svr.Get("/api/settings", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(data_mutex);
        res.set_content(load_settings().dump(), "application/json");
    });

    svr.Put("/api/settings", [](const httplib::Request& req, httplib::Response& res) {
        json body;
        try { body = json::parse(req.body); }
        catch (...) {
            res.status = 400;
            res.set_content(R"({"detail":"Invalid JSON body"})", "application/json");
            return;
        }

        std::lock_guard<std::mutex> lock(data_mutex);
        json s = load_settings();
        if (body.contains("blur")) {
            int b;
            try { b = body["blur"].get<int>(); } catch (...) {
                res.status = 400;
                res.set_content(R"({"detail":"blur must be an integer"})", "application/json");
                return;
            }
            s["blur"] = std::max(0, std::min(20, b));
        }
        if (body.contains("transparency")) {
            double t;
            try { t = body["transparency"].get<double>(); } catch (...) {
                res.status = 400;
                res.set_content(R"({"detail":"transparency must be a number"})", "application/json");
                return;
            }
            s["transparency"] = std::max(0.1, std::min(1.0, t));
        }
        if (body.contains("theme")) {
            std::string theme;
            try { theme = body["theme"].get<std::string>(); } catch (...) {
                res.status = 400;
                res.set_content(R"({"detail":"theme must be a string"})", "application/json");
                return;
            }
            if (theme.size() > MAX_THEME_LEN ||
                std::find(ALLOWED_THEMES.begin(), ALLOWED_THEMES.end(), theme) ==
                    ALLOWED_THEMES.end()) {
                res.status = 400;
                res.set_content(R"({"detail":"Unknown theme"})", "application/json");
                return;
            }
            s["theme"] = theme;
        }
        if (!save_settings(s)) {
            res.status = 500;
            res.set_content(R"({"detail":"Failed to persist settings"})", "application/json");
            return;
        }
        res.set_content(s.dump(), "application/json");
    });

    // ── upload background ─────────────────────────────────
    svr.Post("/api/upload-background", [](const httplib::Request& req, httplib::Response& res) {
        auto file = req.form.get_file("file");
        if (file.filename.empty() || file.content.empty()) {
            res.status = 400;
            res.set_content(R"({"detail":"No file provided"})", "application/json");
            return;
        }

        // Content-based validation; the client-supplied name/extension
        // is never trusted or reused.
        std::string ext;
        if (!sniff_image_ext(file.content, ext)) {
            res.status = 400;
            res.set_content(R"({"detail":"Unsupported image format"})", "application/json");
            return;
        }

        std::lock_guard<std::mutex> lock(data_mutex);
        std::string filename = "bg_" + uuid_hex() + ext;
        if (!write_file_atomic(uploads_dir() / filename, file.content)) {
            res.status = 500;
            res.set_content(R"({"detail":"Failed to store image"})", "application/json");
            return;
        }

        json s = load_settings();
        s["background_image"] = filename;
        if (!save_settings(s)) {
            res.status = 500;
            res.set_content(R"({"detail":"Failed to persist settings"})", "application/json");
            return;
        }
        res.set_content(json{{"filename", filename}}.dump(), "application/json");
    });

    svr.Delete("/api/background", [](const httplib::Request&, httplib::Response& res) {
        std::lock_guard<std::mutex> lock(data_mutex);
        json s = load_settings();
        if (!s["background_image"].is_null()) {
            auto old = uploads_dir() / s["background_image"].get<std::string>();
            if (fs::exists(old)) fs::remove(old);
        }
        s["background_image"] = nullptr;
        if (!save_settings(s)) {
            res.status = 500;
            res.set_content(R"({"detail":"Failed to persist settings"})", "application/json");
            return;
        }
        res.set_content(R"({"ok":true})", "application/json");
    });

    // ── start ─────────────────────────────────────────────
    std::cout << "Server running at http://127.0.0.1:8000" << std::endl;
    svr.listen("127.0.0.1", 8000);
    return 0;
}
