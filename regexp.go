package main

import "regexp"

var wikiLinkRe = regexp.MustCompile(`\[\[([^\]]+)\]\]`)
