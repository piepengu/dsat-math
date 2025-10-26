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
        // Insert spaces between digits and letters when glued: 80plus -> 80 plus; rate40 -> rate 40
        t = t.replace(/(\d)([A-Za-z])/g, '$1 $2')
        t = t.replace(/([A-Za-z])(\d)/g, '$1 $2')
        // Insert a space at sentence boundaries when missing: "ounce.Acustomer" -> "ounce. Acustomer"
        t = t.replace(/([a-z])([A-Z])/g, '$1 $2')
        // Keep currency tight to numbers: "$ 15.00" -> "$15.00"
        t = t.replace(/\$\s+(\d)/g, '$$$1')
        // Common glued phrases
        t = t.replace(/\bperounce\b/gi, (m) => m[0] === 'P' ? 'Per ounce' : 'per ounce')
        // Normalize excess whitespace
        t = t.replace(/\s+/g, ' ').trim()
        return t
    }
    const parts = String(text).split(/(\$[^$]+\$|\\\([^)]*\\\)|\\\[[\s\S]*?\\\])/g)
    return parts.map((seg, i) => {
        const isDollar = seg.startsWith('$') && seg.endsWith('$')
        const isParen = seg.startsWith('\\(') && seg.endsWith('\\)')
        const isBracket = seg.startsWith('\\[') && seg.endsWith('\\]')
        if (isDollar || isParen || isBracket) {
            let inner = isDollar ? seg.slice(1, -1) : seg.slice(2, -2)
            // Fix common malformed fractions like \frac(8)(5) → {\frac{8}{5}}
            inner = inner.replace(/\\frac\s*\(\s*([^()]+?)\s*\)\s*\(\s*([^()]+?)\s*\)/g, '{\\frac{$1}{$2}}')
            // Ensure exponents like ^(2x+1) become ^{2x+1}
            inner = inner.replace(/\^\s*\(([^)]+)\)/g, '^{$1}')
            return <InlineMath key={i} math={inner} />
        }
        const cleaned = normalizePlainText(seg.replace(/\\\s/g, ' ').replace(/\\,/g, ' '))
        return <span key={i}>{cleaned}</span>
    })
}


