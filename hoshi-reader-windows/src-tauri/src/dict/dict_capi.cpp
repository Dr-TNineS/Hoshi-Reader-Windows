#include "dict_capi.h"
#include "hoshidicts.h"
#include <string>
#include <vector>
#include <cstring>
#include <cstdlib>

struct DictQuery {
    DictionaryQuery inner;
};

struct Deinflector {
    ::Deinflector inner;
};

struct LookupEngine {
    DictionaryQuery* query;
    ::Deinflector* deinflector;
    ::Lookup* inner;
};

static void append_json_string(std::string& json, const std::string& value) {
    json += "\"";
    for (unsigned char c : value) {
        switch (c) {
            case '"':
                json += "\\\"";
                break;
            case '\\':
                json += "\\\\";
                break;
            case '\b':
                json += "\\b";
                break;
            case '\f':
                json += "\\f";
                break;
            case '\n':
                json += "\\n";
                break;
            case '\r':
                json += "\\r";
                break;
            case '\t':
                json += "\\t";
                break;
            default:
                if (c < 0x20) {
                    const char hex[] = "0123456789abcdef";
                    json += "\\u00";
                    json += hex[(c >> 4) & 0x0f];
                    json += hex[c & 0x0f];
                } else {
                    json += static_cast<char>(c);
                }
                break;
        }
    }
    json += "\"";
}

static char* glossary_to_json(const std::vector<GlossaryEntry>& glossaries) {
    std::string json = "[";
    for (size_t i = 0; i < glossaries.size(); i++) {
        if (i > 0) json += ",";
        json += "{";
        json += "\"dict\":";
        append_json_string(json, glossaries[i].dict_name);
        json += ",\"text\":";
        append_json_string(json, glossaries[i].glossary);
        json += "}";
    }
    json += "]";
    char* result = (char*)malloc(json.size() + 1);
    memcpy(result, json.c_str(), json.size() + 1);
    return result;
}

static void free_lookup_result(LookupResultC* r) {
    free((void*)r->matched);
    free((void*)r->deinflected);
    free_result(&r->term);
}

static char* strdup_c(const std::string& s) {
    char* result = (char*)malloc(s.size() + 1);
    memcpy(result, s.c_str(), s.size() + 1);
    return result;
}

extern "C" {

DictQuery* dict_query_create(void) {
    return new DictQuery();
}

void dict_query_destroy(DictQuery* q) {
    delete q;
}

int dict_query_add_term_dict(DictQuery* q, const char* path) {
    try {
        q->inner.add_term_dict(path);
        return 0;
    } catch (...) {
        return -1;
    }
}

int dict_query_add_freq_dict(DictQuery* q, const char* path) {
    try {
        q->inner.add_freq_dict(path);
        return 0;
    } catch (...) {
        return -1;
    }
}

int dict_query_add_pitch_dict(DictQuery* q, const char* path) {
    try {
        q->inner.add_pitch_dict(path);
        return 0;
    } catch (...) {
        return -1;
    }
}

Deinflector* deinflector_create(void) {
    return new Deinflector();
}

void deinflector_destroy(Deinflector* d) {
    delete d;
}

LookupEngine* lookup_engine_create(DictQuery* q, Deinflector* d) {
    auto* e = new LookupEngine();
    e->query = q;
    e->deinflector = d;
    e->inner = new ::Lookup(q->inner, d->inner);
    return e;
}

void lookup_engine_destroy(LookupEngine* e) {
    delete e->inner;
    delete e;
}

int lookup_engine_lookup(LookupEngine* e, const char* text, int max_results, int scan_length,
                          ResultCallback cb, void* user_data) {
    try {
        auto results = e->inner->lookup(text, max_results, (size_t)scan_length);
        std::vector<LookupResultC> c_results;
        c_results.reserve(results.size());
        for (auto& r : results) {
            LookupResultC cr;
            cr.matched = strdup_c(r.matched);
            cr.deinflected = strdup_c(r.deinflected);
            cr.term.expression = strdup_c(r.term.expression);
            cr.term.reading = strdup_c(r.term.reading);
            cr.term.rules = strdup_c(r.term.rules);
            cr.term.glossary_json = glossary_to_json(r.term.glossaries);
            cr.term.dict_name = strdup_c(r.term.glossaries.empty() ? "" : r.term.glossaries[0].dict_name);
            cr.preprocessor_steps = r.preprocessor_steps;
            c_results.push_back(cr);
        }
        cb(c_results.data(), (int)c_results.size(), user_data);
        for (auto& cr : c_results) free_lookup_result(&cr);
        return 0;
    } catch (...) {
        return -1;
    }
}

void free_result(TermResultC* r) {
    free((void*)r->expression);
    free((void*)r->reading);
    free((void*)r->rules);
    free((void*)r->glossary_json);
    free((void*)r->dict_name);
}

int dict_import_yomitan_zip(const char* zip_path, const char* output_dir, int low_ram, DictImportResultC* out) {
    if (out == nullptr) {
        return -1;
    }

    try {
        auto result = dictionary_importer::import(zip_path, output_dir, low_ram != 0);
        out->success = result.success ? 1 : 0;
        out->title = strdup_c(result.title);
        out->term_count = result.term_count;
        out->meta_count = result.meta_count;
        out->freq_count = result.freq_count;
        out->pitch_count = result.pitch_count;
        out->media_count = result.media_count;

        std::string errors_json = "[";
        for (size_t i = 0; i < result.errors.size(); i++) {
            if (i > 0) errors_json += ",";
            append_json_string(errors_json, result.errors[i]);
        }
        errors_json += "]";
        out->errors_json = strdup_c(errors_json);
        return 0;
    } catch (...) {
        return -1;
    }
}

void free_import_result(DictImportResultC* r) {
    free((void*)r->title);
    free((void*)r->errors_json);
}

} // extern "C"
