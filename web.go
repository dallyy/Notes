package main

import (
	"context"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// WebResult 实时联网检索结果。
type WebResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

// WebSearcher 实时联网检索（鸭子类型接口）。
type WebSearcher interface {
	Search(ctx context.Context, query string) ([]WebResult, error)
}

// DuckDuckGoSearch 使用 DuckDuckGo HTML 检索（无需 API Key）。
type DuckDuckGoSearch struct {
	client *http.Client
}

func NewDuckDuckGoSearch(client *http.Client) *DuckDuckGoSearch {
	if client == nil {
		client = &http.Client{}
	}
	return &DuckDuckGoSearch{client: client}
}

var (
	ddgLinkRe = regexp.MustCompile(`(?s)<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>`)
	ddgSnipRe = regexp.MustCompile(`(?s)<a[^>]+class="result__snippet"[^>]*>(.*?)</a>`)
	uddgRe    = regexp.MustCompile(`uddg=([^&"]+)`)
	tagRe     = regexp.MustCompile(`<[^>]+>`)
)

// Search 检索并返回最多 5 条结果。
func (s *DuckDuckGoSearch) Search(ctx context.Context, query string) ([]WebResult, error) {
	u := "https://duckduckgo.com/html/?q=" + url.QueryEscape(query)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "+
		"(KHTML, like Gecko) Chrome/120 Safari/537.36")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("实时联网失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("实时联网返回 %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	htmlText := string(body)

	links := ddgLinkRe.FindAllStringSubmatch(htmlText, -1)
	snips := ddgSnipRe.FindAllStringSubmatch(htmlText, -1)
	out := make([]WebResult, 0, 5)
	for i, m := range links {
		if len(out) >= 5 {
			break
		}
		href := m[1]
		title := cleanHTML(m[2])
		snippet := ""
		if i < len(snips) {
			snippet = cleanHTML(snips[i][1])
		}
		if title == "" {
			continue
		}
		if sm := uddgRe.FindStringSubmatch(href); len(sm) > 1 {
			if decoded, err := url.QueryUnescape(sm[1]); err == nil {
				href = decoded
			}
		}
		out = append(out, WebResult{Title: title, URL: href, Snippet: snippet})
	}
	return out, nil
}

func cleanHTML(s string) string {
	s = tagRe.ReplaceAllString(s, " ")
	s = html.UnescapeString(strings.TrimSpace(s))
	return strings.Join(strings.Fields(s), " ")
}
