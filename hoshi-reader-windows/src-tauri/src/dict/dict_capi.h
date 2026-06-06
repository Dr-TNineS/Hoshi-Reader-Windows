#ifndef HOSHIDICTS_CAPI_H
#define HOSHIDICTS_CAPI_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct DictQuery DictQuery;
typedef struct Deinflector Deinflector;
typedef struct LookupEngine LookupEngine;

typedef struct {
    const char* expression;
    const char* reading;
    const char* rules;
    const char* glossary_json;
    const char* dict_name;
} TermResultC;

typedef struct {
    const char* matched;
    const char* deinflected;
    TermResultC term;
    int preprocessor_steps;
} LookupResultC;

typedef struct {
    int success;
    const char* title;
    size_t term_count;
    size_t meta_count;
    size_t freq_count;
    size_t pitch_count;
    size_t media_count;
    const char* errors_json;
} DictImportResultC;

typedef void (*ResultCallback)(const LookupResultC* results, int count, void* user_data);

DictQuery* dict_query_create(void);
void dict_query_destroy(DictQuery* q);
int dict_query_add_term_dict(DictQuery* q, const char* path);
int dict_query_add_freq_dict(DictQuery* q, const char* path);
int dict_query_add_pitch_dict(DictQuery* q, const char* path);

Deinflector* deinflector_create(void);
void deinflector_destroy(Deinflector* d);

LookupEngine* lookup_engine_create(DictQuery* q, Deinflector* d);
void lookup_engine_destroy(LookupEngine* e);
int lookup_engine_lookup(LookupEngine* e, const char* text, int max_results, int scan_length, ResultCallback cb, void* user_data);

int dict_import_yomitan_zip(const char* zip_path, const char* output_dir, int low_ram, DictImportResultC* out);
void free_result(TermResultC* r);
void free_import_result(DictImportResultC* r);

#ifdef __cplusplus
}
#endif

#endif
