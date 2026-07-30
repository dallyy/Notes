#include <httplib.h>
#include <nlohmann/json.hpp>

#include <fstream>
#include <filesystem>
#include <chrono>
#include <random>
#include <sstream>
#include <iomanip>
#include <ctime>
#include <algorithm>
#include <cstdio>

namespace fs = std::filesystem;
using json = nlohmann::json;

// ── paths ────────────────────────────────────────────────────
fs::path BASE_DIR;

fs::path data_dir()   { return BASE_DIR / "data"; }
fs::path uploads_dir(){ return BASE_DIR / "uploads"; }
fs::path notes_path() { return data_dir() / "notes.json"; }
fs::path settings_path(){ return data_dir() / "settings.json"; }

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
#ifdef _WIN32
    gmtime_s(&gmt, &t);
#else
    gmtime_r(&t, &gmt);
#endif
    std::ostringstream ss;
    ss << std::put_time(&gmt, "%Y-%m-%dT%H:%M:%S");
    ss << "." << std::setfill('0') << std::setw(3) << ms.count();
    ss << "+00:00";
    return ss.str();
}

json read_json(const fs::path& path, const json& def) {
    if (fs::exists(path)) {
        std::ifstream f(path);
        if (f.is_open()) return json::parse(f, nullptr, false);
    }
    return def;
}

void write_json(const fs::path& path, const json& data) {
    fs::create_directories(path.parent_path());
    std::ofstream f(path);
    f << data.dump(2);
}

json load_notes()   { return read_json(notes_path(), json::array()); }
void save_notes(const json& n) { write_json(notes_path(), n); }

json default_settings() {
    return {{"background_image", nullptr}, {"blur", 0},
            {"transparency", 1.0}, {"theme", "cyan"}};
}
json load_settings()   { return read_json(settings_path(), default_settings()); }
void save_settings(const json& s) { write_json(settings_path(), s); }

// ── main ─────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    // Determine base directory from executable path
    fs::path exe = fs::absolute(fs::path(argv[0]));
    BASE_DIR = exe.parent_path();

    // Ensure data directories exist
    fs::create_directories(data_dir());
    fs::create_directories(uploads_dir());

    httplib::Server svr;

    // ── page ──────────────────────────────────────────────
    svr.Get("/", [](const httplib::Request&, httplib::Response& res) {
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
        json notes = load_notes();
        res.set_content(notes.dump(), "application/json");
    });

    svr.Post("/api/notes", [](const httplib::Request& req, httplib::Response& res) {
        json body;
        try { body = json::parse(req.body); }
        catch (...) { body = json::object(); }

        json notes = load_notes();
        json note;
        note["id"] = uuid_hex();
        note["title"] = body.value("title", "");
        note["content"] = body.value("content", "");
        note["created_at"] = now_iso();
        note["updated_at"] = note["created_at"];
        notes.push_back(note);
        save_notes(notes);
        res.set_content(note.dump(), "application/json");
    });

    svr.Put(R"(/api/notes/([a-f0-9]+))", [](const httplib::Request& req, httplib::Response& res) {
        std::string note_id = req.matches[1];
        json body;
        try { body = json::parse(req.body); }
        catch (...) { body = json::object(); }

        json notes = load_notes();
        for (auto& n : notes) {
            if (n["id"] == note_id) {
                if (body.contains("title")) n["title"] = body["title"];
                if (body.contains("content")) n["content"] = body["content"];
                n["updated_at"] = now_iso();
                save_notes(notes);
                res.set_content(n.dump(), "application/json");
                return;
            }
        }
        res.status = 404;
        res.set_content(R"({"detail":"Note not found"})", "application/json");
    });

    svr.Delete(R"(/api/notes/([a-f0-9]+))", [](const httplib::Request& req, httplib::Response& res) {
        std::string note_id = req.matches[1];
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
        save_notes(filtered);
        res.set_content(R"({"ok":true})", "application/json");
    });

    // ── settings api ──────────────────────────────────────
    svr.Get("/api/settings", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(load_settings().dump(), "application/json");
    });

    svr.Put("/api/settings", [](const httplib::Request& req, httplib::Response& res) {
        json body;
        try { body = json::parse(req.body); }
        catch (...) { body = json::object(); }

        json s = load_settings();
        if (body.contains("blur"))
            s["blur"] = std::max(0, std::min(20, body["blur"].get<int>()));
        if (body.contains("transparency"))
            s["transparency"] = std::max(0.1, std::min(1.0, body["transparency"].get<double>()));
        if (body.contains("theme"))
            s["theme"] = body["theme"];
        save_settings(s);
        res.set_content(s.dump(), "application/json");
    });

    // ── upload background ─────────────────────────────────
    svr.Post("/api/upload-background", [](const httplib::Request& req, httplib::Response& res) {
        auto file = req.get_file_value("file");
        if (file.filename.empty()) {
            res.status = 400;
            res.set_content(R"({"detail":"No file provided"})", "application/json");
            return;
        }
        std::string ext = fs::path(file.filename).extension().string();
        std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
        if (ext != ".jpg" && ext != ".jpeg" && ext != ".png" &&
            ext != ".gif" && ext != ".webp") {
            res.status = 400;
            res.set_content(R"({"detail":"Unsupported image format"})", "application/json");
            return;
        }
        std::string filename = "bg_" + uuid_hex() + ext;
        std::ofstream out(uploads_dir() / filename, std::ios::binary);
        out.write(file.content.data(), file.content.size());

        json s = load_settings();
        s["background_image"] = filename;
        save_settings(s);
        res.set_content(json{{"filename", filename}}.dump(), "application/json");
    });

    svr.Delete("/api/background", [](const httplib::Request&, httplib::Response& res) {
        json s = load_settings();
        if (!s["background_image"].is_null()) {
            auto old = uploads_dir() / s["background_image"].get<std::string>();
            if (fs::exists(old)) fs::remove(old);
        }
        s["background_image"] = nullptr;
        save_settings(s);
        res.set_content(R"({"ok":true})", "application/json");
    });

    // ── start ─────────────────────────────────────────────
    std::cout << "Server running at http://127.0.0.1:8000" << std::endl;
    svr.listen("127.0.0.1", 8000);
    return 0;
}
