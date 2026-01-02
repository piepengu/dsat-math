import { InlineMath } from 'react-katex'

// Shared inline LaTeX renderer used across the app.
// Supports $...$, \(...\), and treats \[...\] inline when encountered in text.
// Includes fixes for common malformed fractions and exponent groups.
export const renderInlineMath = (text: string) => {
    const normalizePlainText = (input: string): string => {
        let t = String(input)
        // Join letter-by-letter words like "p l u s" -> "plus"
        t = t.replace(/\b(?:[A-Za-z]\s+){2,}[A-Za-z]\b/g, (m) => m.replace(/\s+/g, ''))
        // Collapse duplicate single-letter variables like "h h" -> "h"
        t = t.replace(/\b([A-Za-z])\s+\1\b/g, '$1')
        // Remove duplicate single-letter variables at word boundaries: "x x?" -> "x?"
        t = t.replace(/\b([A-Za-z])\s+([A-Za-z])\s+([?.,!;:])/g, (m, v1, v2, punct) => {
            return v1 === v2 ? `${v1}${punct}` : m
        })
        // Insert spaces between digits and letters when glued: 80plus -> 80 plus; rate40 -> rate 40
        // BUT skip if it looks like a math expression (contains operators like +, -, =, etc.)
        // Check if the match is part of a math expression before adding space
        t = t.replace(/(\d)([A-Za-z])/g, (match, digit, letter, offset, string) => {
            // Check immediate context (characters before and after) for math operators
            const charBefore = offset > 0 ? string[offset - 1] : ' '
            const charAfter = offset + match.length < string.length ? string[offset + match.length] : ' '
            // Also check wider context for math expressions
            const contextBefore = string.substring(Math.max(0, offset - 5), offset)
            const contextAfter = string.substring(offset + match.length, Math.min(string.length, offset + match.length + 5))
            // If we see math operators nearby, don't add space (preserve math expressions like 3x+7=22)
            if (/[+\-*/=<>≤≥]/.test(charBefore + charAfter + contextBefore + contextAfter)) {
                return match
            }
            return `${digit} ${letter}`
        })
        t = t.replace(/([A-Za-z])(\d)/g, (match, letter, digit, offset, string) => {
            // Check immediate context (characters before and after) for math operators
            const charBefore = offset > 0 ? string[offset - 1] : ' '
            const charAfter = offset + match.length < string.length ? string[offset + match.length] : ' '
            // Also check wider context for math expressions
            const contextBefore = string.substring(Math.max(0, offset - 5), offset)
            const contextAfter = string.substring(offset + match.length, Math.min(string.length, offset + match.length + 5))
            // If we see math operators nearby, don't add space (preserve math expressions like x3+5)
            if (/[+\-*/=<>≤≥]/.test(charBefore + charAfter + contextBefore + contextAfter)) {
                return match
            }
            return `${letter} ${digit}`
        })
        // Insert a space at sentence boundaries when missing: "ounce.Acustomer" -> "ounce. Acustomer"
        t = t.replace(/([a-z])([A-Z])/g, '$1 $2')
        // Fix common glued phrases (order matters - do longer patterns first)
        t = t.replace(/\bplusanhourlyrateof\b/gi, (m) => m[0] === 'P' ? 'Plus an hourly rate of' : 'plus an hourly rate of')
        t = t.replace(/\bplusanhourlyrate\b/gi, (m) => m[0] === 'P' ? 'Plus an hourly rate' : 'plus an hourly rate')
        t = t.replace(/\banhourlyrate\b/gi, (m) => m[0] === 'A' ? 'An hourly rate' : 'an hourly rate')
        t = t.replace(/\bplusan\b/gi, (m) => m[0] === 'P' ? 'Plus an' : 'plus an')
        t = t.replace(/\brateof\b/gi, (m) => m[0] === 'R' ? 'Rate of' : 'rate of')
        t = t.replace(/\bperounce\b/gi, (m) => m[0] === 'P' ? 'Per ounce' : 'per ounce')
        t = t.replace(/\bpersquare\b/gi, (m) => m[0] === 'P' ? 'Per square' : 'per square')
        t = t.replace(/\bpercubic\b/gi, (m) => m[0] === 'P' ? 'Per cubic' : 'per cubic')
        // Handle common glued function words
        t = t.replace(/\bforhowmany\b/gi, (m) => m[0] === 'F' ? 'For how many' : 'for how many')
        t = t.replace(/\bhowmany\b/gi, (m) => m[0] === 'H' ? 'How many' : 'how many')
        t = t.replace(/\bwhatis\b/gi, (m) => m[0] === 'W' ? 'What is' : 'what is')
        t = t.replace(/\bwhatare\b/gi, (m) => m[0] === 'W' ? 'What are' : 'what are')
        // Keep currency tight to numbers: "$ 15.00" -> "$15.00"
        t = t.replace(/\$\s+(\d)/g, '$$$1')
        // Normalize excess whitespace
        t = t.replace(/\s+/g, ' ').trim()
        return t
    }
    const parts = String(text).split(/(\$[^$]+\$|\\\([^)]*\\\)|\\\[[\s\S]*?\\\])/g)
    // Post-process to remove duplicate variables that appear both in LaTeX and plain text
    const processedParts: Array<{ type: 'latex' | 'text'; content: string; var?: string }> = []
    for (let i = 0; i < parts.length; i++) {
        const seg = parts[i]
        const isDollar = seg.startsWith('$') && seg.endsWith('$')
        const isParen = seg.startsWith('\\(') && seg.endsWith('\\)')
        const isBracket = seg.startsWith('\\[') && seg.endsWith('\\]')
        if (isDollar || isParen || isBracket) {
            let inner = isDollar ? seg.slice(1, -1) : seg.slice(2, -2)
            // Extract single-letter variable if it's just a variable
            const varMatch = inner.match(/^([a-zA-Z])$/)
            processedParts.push({
                type: 'latex',
                content: seg,
                var: varMatch ? varMatch[1].toLowerCase() : undefined
            })
        } else {
            processedParts.push({ type: 'text', content: seg })
        }
    }
    // Remove duplicate variables: if LaTeX has "x" and next text segment starts with " x", remove the " x"
    for (let i = 0; i < processedParts.length - 1; i++) {
        const curr = processedParts[i]
        const next = processedParts[i + 1]
        if (curr.type === 'latex' && curr.var && next.type === 'text') {
            // Match variable followed by whitespace OR punctuation/end (e.g., " x " or " x?" or " x")
            // Pattern: optional whitespace, variable, then either whitespace OR punctuation OR end
            // Use a more explicit pattern that handles punctuation directly
            const varPattern = new RegExp(`^\\s*${curr.var}(?=\\s|[?.,!;:]|$)`, 'i')
            if (varPattern.test(next.content)) {
                // Remove the variable and any trailing space, but keep punctuation
                next.content = next.content.replace(varPattern, '')
                // Clean up any double spaces that might result
                next.content = next.content.replace(/\s+/g, ' ').trim()
            }
        }
    }
    return processedParts.map((part, i) => {
        if (part.type === 'latex') {
            const seg = part.content
            const isDollar = seg.startsWith('$') && seg.endsWith('$')
            let inner = isDollar ? seg.slice(1, -1) : seg.slice(2, -2)
            // Fix common malformed fractions like \frac(8)(5) → {\frac{8}{5}}
            inner = inner.replace(/\\frac\s*\(\s*([^()]+?)\s*\)\s*\(\s*([^()]+?)\s*\)/g, '{\\frac{$1}{$2}}')
            // Remove unnecessary braces around fractions: {\frac{a}{b}} → \frac{a}{b}
            inner = inner.replace(/\{\\frac\{([^}]+)\}\{([^}]+)\}\}/g, '\\frac{$1}{$2}')
            // Ensure exponents like ^(2x+1) become ^{2x+1}
            inner = inner.replace(/\^\s*\(([^)]+)\)/g, '^{$1}')
            return <InlineMath key={i} math={inner} />
        }
        const cleaned = normalizePlainText(part.content.replace(/\\\s/g, ' ').replace(/\\,/g, ' '))
        return <span key={i}>{cleaned}</span>
    })
}


