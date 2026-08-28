package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// HTTPError 统一 HTTP 错误。
type HTTPError struct {
	Status int
	Detail string
}

func (e HTTPError) Error() string { return e.Detail }

func httpError(status int, format string, args ...any) HTTPError {
	return HTTPError{Status: status, Detail: fmt.Sprintf(format, args...)}
}

func errStatus(err error) (int, string) {
	var he HTTPError
	if errorsAs(err, &he) {
		return he.Status, he.Detail
	}
	return http.StatusInternalServerError, "Internal error: " + err.Error()
}

func errorsAs(err error, target *HTTPError) bool {
	for err != nil {
		if he, ok := err.(HTTPError); ok {
			*target = he
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	b, _ := json.Marshal(v)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Length", fmt.Sprint(len(b)))
	w.WriteHeader(status)
	_, _ = w.Write(b)
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}

func uuidHex() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000+00:00")
}
