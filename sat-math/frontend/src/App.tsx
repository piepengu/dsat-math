import axios from 'axios'
import 'katex/dist/katex.min.css'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BlockMath } from 'react-katex'
import './App.css'
import { CACHE_KEYS, getCached, invalidateCache, setCached } from './utils/cache'
import { renderInlineMath as renderInlineMathShared } from './utils/latex'

type Domain = 'Algebra' | 'PSD' | 'Advanced' | 'Geometry'
type Skill =
    | 'linear_equation'
    | 'linear_equation_mc'
    | 'two_step_equation'
    | 'proportion'
    | 'linear_system_2x2'
    | 'linear_system_3x3'
    | 'quadratic_roots'
    | 'exponential_solve'
    | 'pythagorean_hypotenuse'
    | 'pythagorean_leg'
    | 'rectangle_area'
    | 'rectangle_perimeter'
    | 'triangle_angle'
    | 'rational_equation'
    | 'unit_rate'

type GenerateResponse = {
    domain: string
    skill: string
    format: string
    seed: number
    prompt_latex: string
    choices?: string[]
    diagram?: {
        type: string
        // legacy right_triangle
        a?: number
        b?: number
        c?: number
        labels?: Record<string, string>
        // generic triangle
        points?: Record<string, [number, number]>
        angleMarkers?: Array<{ at: 'A' | 'B' | 'C'; style: 'right' | 'single' | 'double' | 'triple'; radius?: number }>
        sideTicks?: Array<{ side: 'a' | 'b' | 'c'; count: 1 | 2 | 3 }>
        showLabels?: boolean
        triangle?: { mode: 'SSS' | 'SAS' | 'ASA'; A?: number; B?: number; C?: number; a?: number; b?: number; c?: number }
        hints?: string[]
    } | null
}

type GradeResponse = {
    correct: boolean
    correct_answer: string
    explanation_steps: string[]
    why_correct?: string
    why_incorrect_selected?: string
    explanation?: {
        concept?: string
        plan?: string
        quick_check?: string
        common_mistake?: string
    }
}

type GenerateAIResponse = {
    prompt_latex: string
    choices: string[]
    correct_index: number
    explanation_steps: string[]
    diagram?: GenerateResponse['diagram']
    hints?: string[]
    explanation?: {
        concept?: string
        plan?: string
        quick_check?: string
        common_mistake?: string
    }
}

type StreaksResponse = {
    user_id: string
    current_streak_days: number
    longest_streak_days: number
    problems_solved_today: number
    badges_today: string[]
}

type AchievementsResponse = {
    user_id: string
    achievements: string[]
}

function App() {
    const [domain, setDomain] = useState<Domain>('Algebra')
    const [skill, setSkill] = useState<Skill>('linear_equation')
    const [seed, setSeed] = useState<number | null>(null)
    const [latex, setLatex] = useState<string>('')
    const [choices, setChoices] = useState<string[] | null>(null)
    const [diagram, setDiagram] = useState<GenerateResponse['diagram'] | null>(null)
    const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
    const [answer, setAnswer] = useState('')
    const [result, setResult] = useState<GradeResponse | null>(null)
    const [loading, setLoading] = useState(false)
    const [loadPhase, setLoadPhase] = useState<'idle' | 'waking' | 'generating' | 'grading'>('idle')
    const [elapsedMs, setElapsedMs] = useState<number | null>(null)
    const [inSession, setInSession] = useState(false)
    const [sessionLen, setSessionLen] = useState(10)
    const [questionIdx, setQuestionIdx] = useState(0)
    const [numCorrect, setNumCorrect] = useState(0)
    const [estimate, setEstimate] = useState<{ score: number; ci68: [number, number] } | null>(null)
    const [sessionSummary, setSessionSummary] = useState<{ correct: number; total: number } | null>(null)
    const [userId, setUserId] = useState<string>('')
    const [stats, setStats] = useState<Record<string, { attempts: number; correct: number; accuracy: number }> | null>(null)
    const [lastError, setLastError] = useState<string | null>(null)
    const [useAI, setUseAI] = useState<boolean>(false)
    const [adaptive, setAdaptive] = useState<boolean>(false)
    const [aiCorrectIndex, setAiCorrectIndex] = useState<number | null>(null)
    const [aiExplanation, setAiExplanation] = useState<string[] | null>(null)
    const [aiExplanationMeta, setAiExplanationMeta] = useState<GenerateAIResponse['explanation'] | null>(null)
    const [explanationOpen, setExplanationOpen] = useState<boolean>(true)
    const [hints, setHints] = useState<string[]>([])
    const [hintsShown, setHintsShown] = useState<number>(0)
    const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
    const [startTs, setStartTs] = useState<number | null>(null)
    const [nowTs, setNowTs] = useState<number>(Date.now())
    const [aiGenStartTs, setAiGenStartTs] = useState<number | null>(null) // Track AI generation start time
    const [labelsOn, setLabelsOn] = useState<boolean>(true)
    const [showByDifficulty, setShowByDifficulty] = useState<boolean>(false)
    const [missed, setMissed] = useState<Array<{ domain: Domain; skill: Skill; difficulty: 'easy' | 'medium' | 'hard' }>>([])
    const [showAbout, setShowAbout] = useState<boolean>(false)

    // Streaks UI state
    const [streaks, setStreaks] = useState<StreaksResponse | null>(null)
    const [streaksLoading, setStreaksLoading] = useState<boolean>(false)

    // Achievements UI state
    const [achievements, setAchievements] = useState<AchievementsResponse | null>(null)
    const [achievementsLoading, setAchievementsLoading] = useState<boolean>(false)

    // Panel visibility state (collapsible panels)
    const [statsOpen, setStatsOpen] = useState<boolean>(false)
    const [streaksOpen, setStreaksOpen] = useState<boolean>(false)
    const [achievementsOpen, setAchievementsOpen] = useState<boolean>(false)

    // Input ref for auto-focus
    const answerInputRef = useRef<HTMLInputElement>(null)

    // Friendly skill names mapping
    const skillDisplayNames: Record<Skill, string> = {
        linear_equation: 'Linear Equation',
        linear_equation_mc: 'Linear Equation (MC)',
        two_step_equation: 'Two-Step Equation',
        proportion: 'Proportion',
        linear_system_2x2: '2×2 System',
        linear_system_3x3: '3×3 System',
        quadratic_roots: 'Quadratic Roots',
        exponential_solve: 'Exponential Solve',
        pythagorean_hypotenuse: 'Pythagorean (Hypotenuse)',
        pythagorean_leg: 'Pythagorean (Leg)',
        rectangle_area: 'Rectangle Area',
        rectangle_perimeter: 'Rectangle Perimeter',
        triangle_angle: 'Triangle Angle',
        rational_equation: 'Rational Equation',
        unit_rate: 'Unit Rate',
    }

    // Helper function to format error messages
    const formatError = (error: string | null): string | null => {
        if (!error) return null
        try {
            const parsed = JSON.parse(error)
            if (parsed.detail) return parsed.detail
            if (parsed.message) return parsed.message
        } catch {
            // Not JSON, return as-is but clean up
        }
        if (error.includes('Network Error')) return 'Network error. Please check your connection.'
        if (error.includes('timeout') || error.includes('ECONNABORTED')) {
            return 'Request timed out. The free server may still be waking up — try again in a moment.'
        }
        if (error.includes('404')) return 'Service unavailable. Please try again later.'
        if (error.includes('503') || error.includes('502')) {
            return 'Server is starting up. Please wait a few seconds and try again.'
        }
        return error.length > 100 ? error.substring(0, 100) + '...' : error
    }

    // Default rich explanations for AI items (client-side only)
    const aiExplanationDefaults: Partial<Record<Skill, { concept?: string; plan?: string; quick_check?: string; common_mistake?: string }>> = {
        linear_equation: {
            concept: 'Linear equation; distribute and isolate x',
            plan: 'Expand, move constants, divide to isolate x',
            quick_check: 'Plug back to verify LHS = RHS',
            common_mistake: 'Forgetting to distribute to all terms',
        },
        two_step_equation: {
            concept: 'Two-step linear equation',
            plan: 'Undo addition/subtraction, then undo multiplication',
            quick_check: 'Substitute x and check equality',
            common_mistake: 'Dividing before moving the constant term',
        },
        linear_system_2x2: {
            concept: '2×2 linear system',
            plan: 'Eliminate one variable, then back-substitute',
            quick_check: 'Plug (x, y) into both equations',
            common_mistake: 'Adding equations with mismatched coefficients',
        },
        linear_system_3x3: {
            concept: '3×3 linear system',
            plan: 'Eliminate stepwise or use matrix methods',
            quick_check: 'Verify all three equations hold',
            common_mistake: 'Arithmetic errors during elimination',
        },
        quadratic_roots: {
            concept: 'Quadratic roots via factoring',
            plan: 'Factor, set each factor to zero',
            quick_check: 'Each root makes a factor zero',
            common_mistake: 'Missing a root or mixing signs',
        },
        exponential_solve: {
            concept: 'Exponential equation; isolate and take logarithm',
            plan: 'Isolate b^x, then apply log base b',
            quick_check: 'Check a·b^x equals RHS',
            common_mistake: 'Taking logs before isolating the exponential',
        },
        rational_equation: {
            concept: 'Rational equation; clear denominators',
            plan: 'Multiply by LCD, solve resulting equation',
            quick_check: 'Plug solution into original; watch for extraneous',
            common_mistake: 'Not multiplying every term by the LCD',
        },
        proportion: {
            concept: 'Proportion; cross-multiplication',
            plan: 'Cross-multiply, then isolate the variable',
            quick_check: 'Verify a/b = x/c after solving',
            common_mistake: 'Multiplying only one side',
        },
        unit_rate: {
            concept: 'Unit rate (cost per item)',
            plan: 'Divide total cost by number of items',
            quick_check: 'Estimate if the price is reasonable',
            common_mistake: 'Dividing items by cost',
        },
        pythagorean_hypotenuse: {
            concept: 'Right triangle; Pythagorean theorem',
            plan: 'Square legs, add, take square root',
            quick_check: 'Does a^2 + b^2 equal c^2?',
            common_mistake: 'Adding legs without squaring',
        },
        pythagorean_leg: {
            concept: 'Right triangle; find a leg using c^2 - a^2',
            plan: 'Square hypotenuse and known leg, subtract, root',
            quick_check: 'Does c^2 - known^2 equal leg^2?',
            common_mistake: 'Subtracting in the wrong order',
        },
        rectangle_area: {
            concept: 'Area of a rectangle',
            plan: 'Multiply width by height',
            quick_check: 'Units are square; w×h equals area',
            common_mistake: 'Adding sides instead of multiplying',
        },
        rectangle_perimeter: {
            concept: 'Perimeter of a rectangle',
            plan: 'Add width and height, multiply by 2',
            quick_check: 'Units are linear; 2(w+h)',
            common_mistake: 'Using area formula instead of perimeter',
        },
        triangle_angle: {
            concept: 'Triangle interior angles sum to 180°',
            plan: 'Subtract known angles from 180°',
            quick_check: 'Do A+B+C equal 180°?',
            common_mistake: 'Adding instead of subtracting from 180°',
        },
    }

    // Domain → Skill options shown in the second dropdown
    const skillOptions: Record<Domain, Array<{ value: Skill; label: string }>> = {
        Algebra: [
            { value: 'linear_equation', label: 'Linear equation' },
            { value: 'linear_equation_mc', label: 'Linear equation (MC)' },
            { value: 'two_step_equation', label: 'Two-step equation' },
            { value: 'linear_system_2x2', label: '2x2 system' },
        ],
        PSD: [
            { value: 'proportion', label: 'Proportion' },
            { value: 'unit_rate', label: 'Unit rate (word problem)' },
        ],
        Advanced: [
            { value: 'quadratic_roots', label: 'Quadratic roots' },
            { value: 'exponential_solve', label: 'Exponential solve' },
            { value: 'linear_system_3x3', label: '3x3 system' },
            { value: 'rational_equation', label: 'Rational equation' },
        ],
        Geometry: [
            { value: 'pythagorean_hypotenuse', label: 'Pythagorean hypotenuse' },
            { value: 'pythagorean_leg', label: 'Pythagorean leg' },
            { value: 'rectangle_area', label: 'Rectangle area' },
            { value: 'rectangle_perimeter', label: 'Rectangle perimeter' },
            { value: 'triangle_angle', label: 'Triangle interior angle' },
        ],
    }

    const allowedSkills = useMemo(() => skillOptions[domain], [domain])

    const renderInlineMath = (text: string) => renderInlineMathShared(text)

    // Ensure proper line breaks inside environments like cases/aligned/array
    const fixEnvNewlines = (text: string) => {
        const envs = ['cases', 'aligned', 'align', 'align*', 'array', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix']
        let fixed = text
        for (const env of envs) {
            const re = new RegExp(`\\\\begin\\{${env}\\}([\\s\\S]*?)\\\\end\\{${env}\\}`, 'g')
            fixed = fixed.replace(re, (_m, inner) => {
                // Convert single backslash + space used as a line separator to \\
                let cleaned = String(inner)
                    // normalize any single backslash followed by space into \\
                    .replace(/(^|[^\\])\\ (?=\S)/g, '$1\\\\ ')
                    // ensure double-backslashes have a space after for readability
                    .replace(/\\\\\s*/g, '\\\\ ')
                return `\\begin{${env}}${cleaned}\\end{${env}}`
            })
        }
        return fixed
    }

    const normalizeLatex = (text: string) => {
        // Remove disruptive commands, fix environments, and normalize harmless spacing
        let t = text
            // remove stray backslash before inline/block math delimiters like "\ $"
            .replace(/\\\s*\$/g, '$')
            // drop labels that can break KaTeX
            .replace(/\\label\{[^}]*\}/g, '')

        // Fix line separators inside environments before other cleanups
        t = fixEnvNewlines(t)

        // Clean spacing macros that sometimes leak into plain text
        t = t
            .replace(/\\,/g, ' ')
            .replace(/\\;/g, ' ')
            .replace(/\\!/g, ' ')

        // Collapse repeated spaces (preserve backslash sequences)
        t = t.replace(/[ \t]{2,}/g, ' ').trim()

        return t
    }

    const shouldRenderAsBlock = (text: string) => {
        // Render as block only for explicit block delimiters or full environments
        if (/^\s*\\\[[\s\S]*?\\\]\s*$/.test(text)) return true
        if (/^\s*\$\$[\s\S]*?\$\$\s*$/.test(text)) return true
        if (/^\s*\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}\s*$/.test(text)) return true
        return false
    }

    const renderWithEnvironments = (text: string) => {
        const envRe = /(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})/g
        const parts = text.split(envRe)
        return parts.map((seg, i) => {
            if (seg.match(/^\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}$/)) {
                return (
                    <div key={`env-${i}`} className="my-2">
                        <BlockMath math={seg} />
                    </div>
                )
            }
            return <span key={`txt-${i}`}>{renderInlineMath(seg)}</span>
        })
    }

    const maybeRenderPlainText = (text: string) => {
        const m = text.match(/^\\text\{([\s\S]*)\}$/)
        if (m) {
            return <span>{m[1]}</span>
        }
        return null
    }

    const apiBase = useMemo(() => {
        const envBase = (import.meta as any).env?.VITE_API_BASE
        if (typeof envBase === 'string' && envBase.trim() !== '') return envBase
        // Default to Render API when running on GitHub Pages; else local dev
        if (typeof window !== 'undefined' && window.location.host.includes('github.io')) {
            return 'https://dsat-math.onrender.com'
        }
        return 'http://127.0.0.1:8000'
    }, [])

    // ensure persistent user id
    useEffect(() => {
        const key = 'dsat_user_id'
        let uid = localStorage.getItem(key) || ''
        if (!uid) {
            // simple random id
            uid = 'u_' + Math.random().toString(36).slice(2, 10)
            localStorage.setItem(key, uid)
        }
        setUserId(uid)
    }, [])

    const loadQuestion = async () => {
        setLoading(true)
        setLoadPhase('generating')
        setResult(null)
        setAnswer('')
        setSelectedIdx(null)
        setChoices(null)
        setLastError(null)
        setAiCorrectIndex(null)
        setAiExplanation(null)
        setElapsedMs(null)
        try {
            // If adaptive mode is on, fetch next suggested difficulty
            if (adaptive) {
                try {
                    const next = await axios.post<{ domain?: string; skill?: string; difficulty: 'easy' | 'medium' | 'hard' }>(
                        `${apiBase}/next`,
                        { user_id: userId || 'anonymous', domain, skill }
                    )
                    const d = next.data?.difficulty as 'easy' | 'medium' | 'hard'
                    if (d) setDifficulty(d)
                } catch {
                    // ignore; fallback to current difficulty
                }
            }

            if (useAI) {
                setAiGenStartTs(Date.now()) // Track when AI generation starts
                const resp = await axios.post<GenerateAIResponse>(`${apiBase}/generate_ai`, {
                    domain,
                    skill,
                    difficulty,
                })
                setAiGenStartTs(null) // Clear when done
                setLatex(resp.data.prompt_latex)
                setSeed(-1) // AI items are not seeded
                setChoices(resp.data.choices)
                setAiCorrectIndex(resp.data.correct_index)
                setAiExplanation(resp.data.explanation_steps)
                setAiExplanationMeta(resp.data.explanation ?? null)
                setDiagram(resp.data.diagram ?? null)
                setHints(resp.data.hints ?? [])
                setHintsShown(0)
                setLabelsOn((resp.data.diagram as any)?.showLabels ?? true)
            } else {
                const resp = await axios.post<GenerateResponse>(`${apiBase}/generate`, {
                    domain,
                    skill,
                })
                setLatex(resp.data.prompt_latex)
                setSeed(resp.data.seed)
                setChoices(resp.data.choices ?? null)
                setDiagram(resp.data.diagram ?? null)
                setHints((resp.data as any).hints ?? [])
                setHintsShown(0)
                setLabelsOn((resp.data.diagram as any)?.showLabels ?? true)
            }
            setStartTs(Date.now())
            setNowTs(Date.now())
        } catch (e: any) {
            const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e))
            setLastError(msg)
            setAiGenStartTs(null) // Clear on error
        } finally {
            setLoading(false)
            setLoadPhase('idle')
        }
    }

    // Auto-focus answer input when new question loads
    useEffect(() => {
        if (latex && !loading && answerInputRef.current) {
            answerInputRef.current.focus()
        }
    }, [latex, loading])

    // Live timer tick while a question is active (stops when result is set)
    useEffect(() => {
        const active = startTs != null && result == null
        if (!active) return
        const id = setInterval(() => setNowTs(Date.now()), 250)
        return () => clearInterval(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startTs, result])

    // Update estimated wait time display during AI generation
    useEffect(() => {
        if (!aiGenStartTs) return
        const id = setInterval(() => setNowTs(Date.now()), 500)
        return () => clearInterval(id)
    }, [aiGenStartTs])

    const submit = async () => {
        if (seed == null) return
        // Capture and freeze elapsed time before clearing the live timer
        const timeMs = startTs ? Math.max(0, Date.now() - startTs) : undefined
        setElapsedMs(timeMs ?? null)
        setStartTs(null)
        setLoading(true)
        setLoadPhase('grading')
        setLastError(null)
        try {
            if (useAI && choices && aiCorrectIndex != null) {
                const isMC = choices.length > 0
                const correct = isMC ? (selectedIdx ?? -1) === aiCorrectIndex : false
                const correctAnswer = isMC ? choices[aiCorrectIndex] : ''
                const explanation = aiExplanation ?? []
                setResult({
                    correct,
                    correct_answer: correctAnswer,
                    explanation_steps: explanation,
                    explanation: (aiExplanationMeta as any) || aiExplanationDefaults[skill] || undefined,
                })
                if (inSession) setNumCorrect((c) => c + (correct ? 1 : 0))
                if (inSession && !correct) {
                    setMissed((arr) => [...arr, { domain, skill, difficulty }])
                }
                // Release UI immediately; persist AI attempt in background
                setLoading(false)
                setLoadPhase('idle')
                void (async () => {
                    try {
                        await axios.post(`${apiBase}/attempt_ai`, {
                            user_id: userId || 'anonymous',
                            domain,
                            skill,
                            selected_choice_index: selectedIdx ?? -1,
                            correct_index: aiCorrectIndex,
                            correct_answer: correctAnswer,
                            seed: -1,
                            time_ms: timeMs,
                            difficulty,
                        })
                        // Invalidate cache after submitting answer
                        if (userId) {
                            invalidateCache(userId)
                        }
                    } catch {
                        // ignore logging errors
                    }
                })()
                return
            } else {
                const payload: any = {
                    domain,
                    skill,
                    seed,
                    user_id: userId || 'anonymous',
                }
                if (choices && choices.length > 0) {
                    payload.selected_choice_index = selectedIdx ?? -1
                    payload.user_answer = ''
                } else {
                    payload.user_answer = answer
                }
                if (timeMs != null) payload.time_ms = timeMs
                payload.source = useAI ? 'ai' : 'template'
                payload.difficulty = difficulty
                const resp = await axios.post<GradeResponse>(`${apiBase}/grade`, payload)
                setResult(resp.data)
                if (inSession) setNumCorrect((c) => c + (resp.data.correct ? 1 : 0))
                if (inSession && !resp.data.correct) {
                    setMissed((arr) => [...arr, { domain, skill, difficulty }])
                }
                // Invalidate cache after submitting answer
                if (userId) {
                    invalidateCache(userId)
                }
            }
        } catch (e: any) {
            const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e))
            setLastError(msg)
        } finally {
            setLoading(false)
            setLoadPhase('idle')
        }
    }

    useEffect(() => {
        // Warm the free-tier API, then load the first question
        let cancelled = false
        ;(async () => {
            setLoading(true)
            setLoadPhase('waking')
            try {
                await axios.get(`${apiBase}/health`, { timeout: 90000 })
            } catch {
                // Still attempt generate; cold start may recover
            }
            if (!cancelled) {
                await loadQuestion()
            }
        })()
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const loadingLabel = (() => {
        if (loadPhase === 'waking') return 'Waking server…'
        if (loadPhase === 'grading') return 'Checking…'
        if (loadPhase === 'generating' && useAI) {
            const secs = aiGenStartTs ? Math.max(0, Math.round((Date.now() - aiGenStartTs) / 1000)) : 0
            return secs > 0 ? `Generating… ${secs}s` : 'Generating…'
        }
        if (loadPhase === 'generating') return 'Loading question…'
        return 'Loading…'
    })()

    const elapsedSec = startTs != null && result == null
        ? (nowTs - startTs) / 1000
        : (elapsedMs != null ? elapsedMs / 1000 : 0)
    const questionNo = inSession ? questionIdx + 1 : 1

    const renderQuestionBody = () => {
        const norm = normalizeLatex(latex)
        const plain = maybeRenderPlainText(norm)
        if (plain) return plain
        if (/\\\[[\s\S]*?\\\]/.test(norm)) {
            const parts = norm.split(/(\\\[[\s\S]*?\\\])/g)
            return parts.map((seg, i) =>
                seg.startsWith('\\[') && seg.endsWith('\\]') ? (
                    <div key={i} className="my-2">
                        <BlockMath math={seg.slice(2, -2)} />
                    </div>
                ) : (
                    <span key={i}>{renderInlineMath(seg)}</span>
                )
            )
        }
        if (shouldRenderAsBlock(norm)) return <BlockMath math={norm} />
        if (norm.includes('$$')) {
            return norm.split('$$').map((seg, i) =>
                i % 2 === 1 ? (
                    <div key={i} className="my-2">
                        <BlockMath math={seg} />
                    </div>
                ) : (
                    <span key={i}>{renderInlineMath(seg)}</span>
                )
            )
        }
        return renderWithEnvironments(norm)
    }

    return (
        <div className="forge-app">
            <div className="forge-shell">
                {/* Debug banner removed for production; keep a hidden error node to satisfy TS usage */}
                {lastError && (
                    <div className="forge-error">
                        {formatError(lastError)}
                    </div>
                )}
                <header className="forge-masthead">
                    <div>
                        <h1 className={`forge-word ${loading && loadPhase !== 'idle' ? 'is-pouring' : ''}`}>DSAT Math Forge</h1>
                        <p className="forge-kicker">Digital SAT practice · struck in copper</p>
                    </div>
                    <nav className="forge-nav">
                        <button type="button" onClick={() => setShowAbout(true)} aria-label="About DSAT Math Forge">
                            About
                        </button>
                        <a href="formulas.html" target="_blank" rel="noopener" aria-label="Open formula sheet">
                            Formula sheet
                        </a>
                    </nav>
                </header>

                {loading && !latex && (
                    <div className="forge-banner">
                        <div className="font-medium">{loadingLabel}</div>
                        {loadPhase === 'waking' && (
                            <p className="mt-1 text-sm opacity-80">
                                Free hosting may take up to ~45s to wake. The booklet opens right after.
                            </p>
                        )}
                    </div>
                )}

                <div className="forge-book">
                    <aside className="forge-page forge-left">
                        <p className="forge-section-label">Instructions</p>
                        <label className="forge-field">
                            <span>Domain</span>
                            <select
                                className="forge-select"
                                value={domain}
                                onChange={(e) => {
                                    const d = e.target.value as Domain
                                    setDomain(d)
                                    const first = (skillOptions[d][0]?.value || 'linear_equation') as Skill
                                    setSkill(first)
                                }}
                            >
                                <option value="Algebra">Algebra</option>
                                <option value="PSD">Problem Solving & Data Analysis</option>
                                <option value="Advanced">Advanced Math</option>
                                <option value="Geometry">Geometry & Trig</option>
                            </select>
                        </label>
                        <label className="forge-field">
                            <span>Skill</span>
                            <select
                                className="forge-select"
                                value={skill}
                                onChange={(e) => setSkill(e.target.value as Skill)}
                            >
                                {allowedSkills.map((s) => (
                                    <option key={s.value} value={s.value}>{s.label}</option>
                                ))}
                            </select>
                        </label>
                        <label className="forge-field">
                            <span>Difficulty</span>
                            <select
                                className="forge-select"
                                value={difficulty}
                                onChange={(e) => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
                                disabled={adaptive}
                            >
                                <option value="easy">Easy</option>
                                <option value="medium">Medium</option>
                                <option value="hard">Hard</option>
                            </select>
                        </label>
                        <div className="forge-toggles">
                            <label className="forge-check">
                                <input
                                    type="checkbox"
                                    checked={useAI}
                                    onChange={(e) => setUseAI(e.target.checked)}
                                />
                                Use AI
                            </label>
                            <label className="forge-check">
                                <input
                                    type="checkbox"
                                    checked={adaptive}
                                    onChange={(e) => setAdaptive(e.target.checked)}
                                />
                                Adaptive
                            </label>
                        </div>
                        <div className="forge-actions">
                            <button
                                className="forge-btn forge-btn-primary"
                                disabled={loading || inSession}
                                onClick={() => {
                                    setEstimate(null)
                                    setSessionSummary(null)
                                    setQuestionIdx(0)
                                    setNumCorrect(0)
                                    setInSession(false)
                                    void loadQuestion()
                                }}
                            >
                                {loading && loadPhase !== 'grading' ? loadingLabel : 'Next question'}
                            </button>
                        </div>
                        <label className="forge-field" style={{ marginTop: '1.1rem' }}>
                            <span>Session length</span>
                            <input
                                className="forge-input"
                                type="number"
                                min={1}
                                max={44}
                                value={sessionLen}
                                onChange={(e) => setSessionLen(parseInt(e.target.value || '1', 10))}
                                disabled={inSession}
                            />
                        </label>
                        <button
                            className="forge-btn forge-btn-copper"
                            disabled={loading || inSession}
                            onClick={async () => {
                                setEstimate(null)
                                setSessionSummary(null)
                                setQuestionIdx(0)
                                setNumCorrect(0)
                                setInSession(true)
                                await loadQuestion()
                            }}
                        >
                            Start session
                        </button>
                        {(inSession || adaptive) && (
                            <div className="forge-session-meta">
                                {inSession && <>Question {questionIdx + 1} of {sessionLen} · {numCorrect} correct</>}
                                {adaptive && <span>{inSession ? ' · ' : ''}Adaptive: {difficulty}</span>}
                            </div>
                        )}
                        {inSession && (
                            <div className="forge-progress" aria-hidden>
                                <span style={{ width: `${((questionIdx + 1) / sessionLen) * 100}%` }} />
                            </div>
                        )}
                    </aside>
                    <section className="forge-page forge-right">
                        <p className="forge-section-label">Question</p>

                {latex && (
                    <div className="forge-stem" key={latex}>
                        <div className="forge-qnum" aria-hidden>
                            <svg className="forge-timer" viewBox="0 0 44 44">
                                <circle className="forge-timer-track" cx="22" cy="22" r="18" />
                                <circle
                                    className="forge-timer-fill"
                                    cx="22"
                                    cy="22"
                                    r="18"
                                    strokeDasharray={2 * Math.PI * 18}
                                    strokeDashoffset={2 * Math.PI * 18 * (1 - Math.min(1, elapsedSec / 90))}
                                />
                            </svg>
                            <div className="forge-qnum-text">{questionNo}</div>
                        </div>
                        <div>
                            <div className="forge-skill-line">
                                {skillOptions[domain].find(s => s.value === skill)?.label || skill}
                                {' · '}
                                {difficulty}
                            </div>
                            <div className="question-card">
                                {renderQuestionBody()}
                            </div>
                            {(startTs != null && result == null) || (result && elapsedMs != null) ? (
                                <div className="forge-time-caption">
                                    {result && elapsedMs != null
                                        ? `Solved in ${elapsedSec.toFixed(1)}s`
                                        : `${elapsedSec.toFixed(1)}s`}
                                </div>
                            ) : null}
                        </div>
                    </div>
                )}

                {(hints && hints.length > 0) && (
                    <div className="forge-hint">
                        <button
                            className="forge-btn forge-btn-ghost"
                            onClick={() => setHintsShown((n) => Math.min(hints.length, n + 1))}
                            disabled={hintsShown >= hints.length}
                        >
                            {hintsShown >= hints.length ? 'All hints shown' : 'Need a hint?'}
                        </button>
                        {hintsShown > 0 && (
                            <ul className="mt-2 list-disc list-inside text-sm space-y-1">
                                {hints.slice(0, hintsShown).map((h, i) => (
                                    <li key={i}>{h}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {diagram && (
                    <div className="mb-3">
                        <div className="flex items-center gap-3 mb-2">
                            <label className="forge-check">
                                <input
                                    type="checkbox"
                                    checked={labelsOn}
                                    onChange={(e) => setLabelsOn(e.target.checked)}
                                />
                                Show labels
                            </label>
                        </div>
                        {diagram.type === 'right_triangle' && (
                            <RightTriangle
                                a={diagram.a || 0}
                                b={diagram.b || 0}
                                c={diagram.c || 0}
                                labels={diagram.labels || {}}
                                showLabels={labelsOn}
                            />
                        )}
                        {diagram.type === 'triangle' && (
                            <TriangleDiagram spec={diagram} showLabels={labelsOn} />
                        )}
                    </div>
                )}

                <div className="forge-answer-row">
                    {choices && choices.length > 0 ? (
                        <div className="forge-choices w-full">
                            {(() => {
                                const letters = ['A', 'B', 'C', 'D', 'E']
                                const resolvedCorrectIdx = useAI && aiCorrectIndex != null
                                    ? aiCorrectIndex
                                    : (result && choices ? choices.findIndex((cc) => cc === result.correct_answer) : -1)
                                return choices.map((c, idx) => {
                                    let cls = 'forge-choice'
                                    if (result) {
                                        if (idx === resolvedCorrectIdx) cls += ' is-correct'
                                        else if (selectedIdx === idx && !result.correct) cls += ' is-wrong'
                                    } else if (selectedIdx === idx) {
                                        cls += ' is-selected'
                                    }
                                    return (
                                        <label key={idx} className={cls}>
                                            <input
                                                type="radio"
                                                name="mc"
                                                checked={selectedIdx === idx}
                                                onChange={() => setSelectedIdx(idx)}
                                                disabled={!!result}
                                            />
                                            <span className="forge-bubble">{letters[idx] || idx + 1}</span>
                                            <span className="flex items-center gap-2">{renderInlineMath(c)}</span>
                                            {result && idx === resolvedCorrectIdx && (
                                                <span className="forge-choice-mark">Correct</span>
                                            )}
                                            {result && selectedIdx === idx && !result.correct && (
                                                <span className="forge-choice-mark">Yours</span>
                                            )}
                                        </label>
                                    )
                                })
                            })()}
                        </div>
                    ) : (
                        <input
                            ref={answerInputRef}
                            className="forge-input"
                            value={answer}
                            onChange={(e) => setAnswer(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !loading && seed != null) {
                                    e.preventDefault()
                                    submit()
                                }
                            }}
                            placeholder="Enter your answer"
                        />
                    )}
                    <button
                        className="forge-btn forge-btn-primary"
                        disabled={loading || seed == null}
                        onClick={submit}
                    >
                        {loadPhase === 'grading' ? 'Checking…' : 'Submit'}
                    </button>
                    {inSession && result && (
                        <button
                            className="forge-btn forge-btn-copper"
                            disabled={loading}
                            onClick={async () => {
                                const nextIdx = questionIdx + 1
                                if (nextIdx >= sessionLen) {
                                    setLoading(true)
                                    try {
                                        const est = await axios.post<{ score: number; ci68: [number, number] }>(
                                            `${apiBase}/estimate`,
                                            { correct: numCorrect, total: sessionLen }
                                        )
                                        setEstimate({ score: est.data.score, ci68: est.data.ci68 })
                                        setSessionSummary({ correct: numCorrect, total: sessionLen })
                                    } finally {
                                        setLoading(false)
                                    }
                                    setInSession(false)
                                } else {
                                    setQuestionIdx(nextIdx)
                                    setResult(null)
                                    setAnswer('')
                                    await loadQuestion()
                                }
                            }}
                        >
                            {questionIdx + 1 >= sessionLen ? 'Finish' : 'Next'}
                        </button>
                    )}
                </div>

                {result && (
                    <div className="forge-result">
                        <div className={`forge-stamp ${result.correct ? '' : 'is-wrong'}`}>
                            {result.correct ? 'Correct' : 'Incorrect'}
                        </div>
                        {!result.correct && result.why_incorrect_selected && (
                            <div className="text-sm" style={{ color: 'var(--wrong)' }}>{result.why_incorrect_selected}</div>
                        )}
                        <button
                            className="forge-explain-toggle"
                            onClick={() => setExplanationOpen((v) => !v)}
                        >
                            {explanationOpen ? 'Hide explanation' : 'Show explanation'}
                        </button>
                        {explanationOpen && (
                            <div className="forge-margin">
                                <h3>Margin notes</h3>
                                <div className="text-sm mb-2">Answer: {result.correct_answer}</div>
                                <button
                                    className="forge-btn forge-btn-ghost"
                                    style={{ padding: '0.4rem 0.65rem', fontSize: '0.72rem', marginBottom: '0.6rem' }}
                                    onClick={async () => {
                                        const parts: string[] = []
                                        if (result.explanation?.concept) parts.push(`Concept: ${result.explanation.concept}`)
                                        if (result.explanation?.plan) parts.push(`Plan: ${result.explanation.plan}`)
                                        result.explanation_steps.forEach((s, i) => parts.push(`${i + 1}. ${s}`))
                                        if (result.explanation?.quick_check) parts.push(`Quick check: ${result.explanation.quick_check}`)
                                        if (result.explanation?.common_mistake) parts.push(`Common mistake: ${result.explanation.common_mistake}`)
                                        try {
                                            await navigator.clipboard.writeText(parts.join('\n'))
                                        } catch {
                                            // no-op
                                        }
                                    }}
                                >
                                    Copy notes
                                </button>
                                <ElaborateTutor
                                    apiBase={apiBase}
                                    userId={userId}
                                    domain={domain}
                                    skill={skill}
                                    difficulty={difficulty}
                                    promptLatex={latex}
                                    steps={result.explanation_steps}
                                    correctAnswer={result.correct_answer}
                                />
                                {result.explanation?.concept && (
                                    <p className="forge-note"><span className="forge-note-label">Concept</span>{renderInlineMath(result.explanation.concept)}</p>
                                )}
                                {result.explanation?.plan && (
                                    <p className="forge-note"><span className="forge-note-label">Plan</span>{renderInlineMath(result.explanation.plan)}</p>
                                )}
                                <ol className="list-decimal list-inside space-y-1">
                                    {result.explanation_steps.map((s, i) => (
                                        <li key={i}>{renderInlineMath(s)}</li>
                                    ))}
                                </ol>
                                {result.explanation?.quick_check && (
                                    <p className="forge-note"><span className="forge-note-label">Check</span>{renderInlineMath(result.explanation.quick_check)}</p>
                                )}
                                {result.explanation?.common_mistake && (
                                    <p className="forge-note"><span className="forge-note-label">Common slip</span>{renderInlineMath(result.explanation.common_mistake)}</p>
                                )}
                            </div>
                        )}
                    </div>
                )}
                    </section>
                </div>

                {!inSession && missed.length > 0 && (
                    <div className="mt-6 p-4 forge-footer">
                        <div className="font-semibold mb-2" style={{ fontFamily: 'var(--serif)' }}>Review missed questions</div>
                        <ul className="space-y-2">
                            {missed.map((m, idx) => (
                                <li key={idx} className="flex items-center justify-between gap-3">
                                    <div className="text-sm text-gray-700">
                                        {m.domain} · {m.skill} · {m.difficulty}
                                    </div>
                                    <button
                                        className="forge-btn forge-btn-primary"
                                        onClick={async () => {
                                            setDomain(m.domain)
                                            setSkill(m.skill)
                                            setDifficulty(m.difficulty)
                                            setInSession(false)
                                            setResult(null)
                                            setAnswer('')
                                            await loadQuestion()
                                        }}
                                    >
                                        Retry
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <div className="mt-3">
                            <button
                                className="forge-btn forge-btn-ghost"
                                onClick={() => setMissed([])}
                            >
                                Clear review list
                            </button>
                        </div>
                    </div>
                )}

                {sessionSummary && (
                    <div className="mt-4 p-3 forge-footer">
                        <div className="text-base font-semibold" style={{ fontFamily: 'var(--serif)', color: 'var(--ok)' }}>
                            Session complete: {sessionSummary.correct}/{sessionSummary.total} correct • Accuracy {Math.round((sessionSummary.correct / sessionSummary.total) * 100)}%
                        </div>
                    </div>
                )}

                {estimate && (
                    <div className="mt-4 p-4 forge-footer">
                        <div className="font-bold" style={{ fontFamily: 'var(--serif)' }}>Estimated SAT Math score</div>
                        <div className="text-2xl">
                            {estimate.score}{' '}
                            <span className="text-sm text-gray-600">(68% CI {estimate.ci68[0]}–{estimate.ci68[1]})</span>
                        </div>
                        <div className="mt-2 text-sm text-gray-700">
                            Start another session or continue practicing individual questions.
                        </div>
                    </div>
                )}

                <div className="forge-footer">
                    <div className="forge-footer-row">
                        <button
                            className="forge-btn forge-btn-ghost"
                            disabled={loading || !userId}
                            onClick={async () => {
                                if (!userId) return
                                setStatsOpen(!statsOpen)
                                if (!statsOpen) {
                                    // Check cache first
                                    const cacheKey = CACHE_KEYS.stats(userId)
                                    const cached = getCached<Record<string, { attempts: number; correct: number; accuracy: number }>>(cacheKey)
                                    if (cached) {
                                        setStats(cached)
                                        return
                                    }

                                    setLoading(true)
                                    try {
                                        const resp = await axios.get<Record<string, { attempts: number; correct: number; accuracy: number }>>(
                                            `${apiBase}/stats`,
                                            { params: { user_id: userId } }
                                        )
                                        setStats(resp.data)
                                        setCached(cacheKey, resp.data)
                                    } catch (e: any) {
                                        const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e))
                                        setLastError(msg)
                                    } finally {
                                        setLoading(false)
                                    }
                                }
                            }}
                        >
                            My Stats
                        </button>
                        <button
                            className="forge-btn forge-btn-ghost"
                            disabled={streaksLoading || !userId}
                            onClick={async () => {
                                if (!userId) return
                                setStreaksOpen(!streaksOpen)
                                if (!streaksOpen) {
                                    // Check cache first
                                    const cacheKey = CACHE_KEYS.streaks(userId)
                                    const cached = getCached<StreaksResponse>(cacheKey)
                                    if (cached) {
                                        setStreaks(cached)
                                        return
                                    }

                                    setStreaksLoading(true)
                                    try {
                                        const resp = await axios.get<StreaksResponse>(`${apiBase}/streaks`, { params: { user_id: userId } })
                                        setStreaks(resp.data)
                                        setCached(cacheKey, resp.data)
                                    } catch (e: any) {
                                        const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e))
                                        setLastError(msg)
                                    } finally {
                                        setStreaksLoading(false)
                                    }
                                }
                            }}
                        >
                            {streaksLoading ? 'Loading…' : 'Streaks'}
                        </button>
                        <button
                            className="forge-btn forge-btn-ghost"
                            disabled={achievementsLoading || !userId}
                            onClick={async () => {
                                if (!userId) return
                                setAchievementsOpen(!achievementsOpen)
                                if (!achievementsOpen) {
                                    // Check cache first
                                    const cacheKey = CACHE_KEYS.achievements(userId)
                                    const cached = getCached<AchievementsResponse>(cacheKey)
                                    if (cached) {
                                        setAchievements(cached)
                                        return
                                    }

                                    setAchievementsLoading(true)
                                    try {
                                        const resp = await axios.get<AchievementsResponse>(`${apiBase}/achievements`, { params: { user_id: userId } })
                                        setAchievements(resp.data)
                                        setCached(cacheKey, resp.data)
                                    } catch (e: any) {
                                        const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e))
                                        setLastError(msg)
                                    } finally {
                                        setAchievementsLoading(false)
                                    }
                                }
                            }}
                        >
                            {achievementsLoading ? 'Loading…' : 'Achievements'}
                        </button>
                        <button
                            className="forge-btn forge-btn-danger ml-auto"
                            disabled={loading || !userId}
                            onClick={async () => {
                                if (!userId) return
                                setLoading(true)
                                try {
                                    await axios.post(`${apiBase}/reset_stats`, { user_id: userId })
                                    // Invalidate cache after reset
                                    invalidateCache(userId)
                                    // Refresh stats after reset
                                    const resp = await axios.get<Record<string, { attempts: number; correct: number; accuracy: number }>>(
                                        `${apiBase}/stats`,
                                        { params: { user_id: userId } }
                                    )
                                    setStats(resp.data)
                                    setCached(CACHE_KEYS.stats(userId), resp.data)
                                } catch (e: any) {
                                    const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e))
                                    setLastError(msg)
                                } finally {
                                    setLoading(false)
                                }
                            }}
                        >
                            Reset stats
                        </button>
                    </div>
                    {stats && statsOpen && (
                        <div className="mt-4">
                            <div className="flex items-center justify-between mb-2">
                                <div className="font-semibold">Stats</div>
                                <button
                                    onClick={() => setStatsOpen(false)}
                                    className="text-xs text-gray-500 hover:text-gray-700"
                                >
                                    ✕ Close
                                </button>
                            </div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm text-gray-700 flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        className="accent-indigo-600"
                                        checked={showByDifficulty}
                                        onChange={(e) => setShowByDifficulty(e.target.checked)}
                                    />
                                    Show per-difficulty
                                </label>
                            </div>
                            {!showByDifficulty && (
                                <>
                                <div className="mb-1 text-sm font-semibold text-gray-700">
                                    Overall by skill
                                </div>
                                <table className="forge-table">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="text-left p-2 text-gray-900">Skill</th>
                                            <th className="text-right p-2 text-gray-900">Attempts</th>
                                            <th className="text-right p-2 text-gray-900">Correct</th>
                                            <th className="text-right p-2 text-gray-900">Accuracy</th>
                                            <th className="text-right p-2 text-gray-900">Avg time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.entries(stats)
                                            .filter(([sk]) => !sk.startsWith('__'))
                                            .map(([sk, v]) => {
                                                const accuracyPercent = Math.round(v.accuracy * 100)
                                                const accuracyColor = accuracyPercent >= 80 ? 'text-green-700 font-semibold' : accuracyPercent >= 50 ? 'text-yellow-700' : 'text-red-700'
                                                return (
                                                    <tr key={sk} className="border-b last:border-0 hover:bg-gray-50">
                                                        <td className="p-2 font-medium">{skillDisplayNames[sk as Skill] || sk}</td>
                                                        <td className="text-right p-2">{v.attempts}</td>
                                                        <td className="text-right p-2">{v.correct}</td>
                                                        <td className={`text-right p-2 ${accuracyColor}`}>{accuracyPercent}%</td>
                                                        <td className="text-right p-2">{(v as any).avg_time_s ? `${((v as any).avg_time_s as number).toFixed(1)}s` : '-'}</td>
                                                    </tr>
                                                )
                                            })}
                                    </tbody>
                                </table>
                                </>
                            )}

                            {/* Per-difficulty breakdown if provided by backend */}
                            {showByDifficulty && Boolean((stats as any).__by_difficulty) && (
                                <>
                                <div className="mb-1 text-sm font-semibold text-gray-700">
                                    By difficulty
                                </div>
                                <table className="forge-table">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="text-left p-2 text-gray-900">Skill</th>
                                            <th className="text-left p-2 text-gray-900">Difficulty</th>
                                            <th className="text-right p-2 text-gray-900">Attempts</th>
                                            <th className="text-right p-2 text-gray-900">Correct</th>
                                            <th className="text-right p-2 text-gray-900">Accuracy</th>
                                            <th className="text-right p-2 text-gray-900">Avg time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.entries((stats as any).__by_difficulty as Record<string, Record<string, any>>)
                                            .flatMap(([sk, diffMap]) =>
                                                Object.entries(diffMap).map(([diff, v]) => (
                                                    <tr key={`${sk}-${diff}`} className="border-b last:border-0 hover:bg-gray-50">
                                                        <td className="p-2 font-medium">{skillDisplayNames[sk as Skill] || sk}</td>
                                                        <td className="p-2 capitalize">{diff}</td>
                                                        <td className="text-right p-2">{(v as any).attempts}</td>
                                                        <td className="text-right p-2">{(v as any).correct}</td>
                                                        <td className={`text-right p-2 ${Math.round(((v as any).accuracy || 0) * 100) >= 80 ? 'text-green-700 font-semibold' : Math.round(((v as any).accuracy || 0) * 100) >= 50 ? 'text-yellow-700' : 'text-red-700'}`}>
                                                            {Math.round(((v as any).accuracy || 0) * 100)}%
                                                        </td>
                                                        <td className="text-right p-2">{(v as any).avg_time_s ? `${((v as any).avg_time_s as number).toFixed(1)}s` : '-'}</td>
                                                    </tr>
                                                ))
                                            )}
                                    </tbody>
                                </table>
                                </>
                            )}

                            {/* Per-source breakdown (AI vs template) */}
                            {Boolean((stats as any).__by_source) && (
                                <>
                                <div className="mt-5 mb-1 text-sm font-semibold text-gray-700">
                                    By source (AI vs Template)
                                </div>
                                <table className="forge-table">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="text-left p-2 text-gray-900">Skill</th>
                                            <th className="text-left p-2 text-gray-900">Source</th>
                                            <th className="text-right p-2 text-gray-900">Attempts</th>
                                            <th className="text-right p-2 text-gray-900">Correct</th>
                                            <th className="text-right p-2 text-gray-900">Accuracy</th>
                                            <th className="text-right p-2 text-gray-900">Avg time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.entries((stats as any).__by_source as Record<string, Record<string, any>>)
                                            .flatMap(([sk, srcMap]) =>
                                                Object.entries(srcMap).map(([src, v]) => {
                                                    const accuracyPercent = Math.round(((v as any).accuracy || 0) * 100)
                                                    const accuracyColor = accuracyPercent >= 80 ? 'text-green-700 font-semibold' : accuracyPercent >= 50 ? 'text-yellow-700' : 'text-red-700'
                                                    return (
                                                        <tr key={`${sk}-${src}`} className="border-b last:border-0 hover:bg-gray-50">
                                                            <td className="p-2 font-medium">{skillDisplayNames[sk as Skill] || sk}</td>
                                                            <td className="p-2">{src.toLowerCase() === 'ai' ? 'AI' : 'Template'}</td>
                                                            <td className="text-right p-2">{(v as any).attempts}</td>
                                                            <td className="text-right p-2">{(v as any).correct}</td>
                                                            <td className={`text-right p-2 ${accuracyColor}`}>{accuracyPercent}%</td>
                                                            <td className="text-right p-2">{(v as any).avg_time_s ? `${((v as any).avg_time_s as number).toFixed(1)}s` : '-'}</td>
                                                        </tr>
                                                    )
                                                })
                                            )}
                                    </tbody>
                                </table>
                                </>
                            )}
                        </div>
                    )}
                    {streaks && streaksOpen && (
                        <div className="mt-4 p-4 border border-gray-200 rounded-md bg-white shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                                <div className="font-semibold">Streak</div>
                                <button
                                    onClick={() => setStreaksOpen(false)}
                                    className="text-xs text-gray-500 hover:text-gray-700"
                                >
                                    ✕ Close
                                </button>
                            </div>
                            <div className="text-sm text-gray-800 flex flex-wrap gap-4">
                                <div>Current: <span className="font-semibold">{streaks.current_streak_days}</span> day(s)</div>
                                <div>Longest: <span className="font-semibold">{streaks.longest_streak_days}</span> day(s)</div>
                                <div>Today: <span className="font-semibold">{streaks.problems_solved_today}</span> problem(s)</div>
                            </div>
                            {streaks.badges_today && streaks.badges_today.length > 0 && (
                                <div className="mt-2 text-sm text-gray-800">
                                    <div className="mb-1">Badges earned today:</div>
                                    <div className="flex flex-wrap gap-2">
                                        {streaks.badges_today.map((b, i) => (
                                            <span key={i} className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-xs">{b}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {achievements && achievementsOpen && (
                        <div className="mt-4 p-4 border border-gray-200 rounded-md bg-white shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                                <div className="font-semibold">Achievements</div>
                                <button
                                    onClick={() => setAchievementsOpen(false)}
                                    className="text-xs text-gray-500 hover:text-gray-700"
                                >
                                    ✕ Close
                                </button>
                            </div>
                            {achievements.achievements && achievements.achievements.length > 0 ? (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {achievements.achievements.map((ach, i) => {
                                        const displayName: Record<string, string> = {
                                            first_solve: 'First Solve',
                                            five_correct_streak: '5 Correct in a Row',
                                            seven_day_streak: '7 Day Streak',
                                        }
                                        return (
                                            <span
                                                key={i}
                                                className="px-3 py-1 rounded bg-purple-100 text-purple-800 text-sm font-semibold"
                                            >
                                                {displayName[ach] || ach}
                                            </span>
                                        )
                                    })}
                                </div>
                            ) : (
                                <div className="text-sm text-gray-500 mt-2">No achievements yet. Keep practicing!</div>
                            )}
                        </div>
                    )}
                </div>

                {/* About Modal */}
                {showAbout && (
                    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(7, 21, 37, 0.72)' }} onClick={() => setShowAbout(false)}>
                        <div className="forge-modal max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                            <div>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-2xl font-bold" style={{ fontFamily: 'var(--serif)', color: 'var(--navy)' }}>How DSAT Math Forge Works</h3>
                                    <button
                                        onClick={() => setShowAbout(false)}
                                        className="text-gray-500 hover:text-gray-700 text-2xl font-bold leading-none"
                                        aria-label="Close"
                                    >
                                        ×
                                    </button>
                                </div>

                                <div className="space-y-4 text-gray-700">
                                    <div>
                                        <h4 className="font-semibold text-lg mb-2">AI-Powered Explanations</h4>
                                        <p className="text-sm">
                                            DSAT Math Forge uses <strong>Google Gemini models</strong> (primarily Gemini 2.5 Flash) to generate step-by-step SAT math explanations.
                                            Custom prompts enforce a structured approach: <strong>Concept → Plan → Steps → Verification</strong>.
                                        </p>
                                    </div>

                                    <div>
                                        <h4 className="font-semibold text-lg mb-2">Adaptive Practice</h4>
                                        <p className="text-sm">
                                            <strong>Adaptive Mode</strong> adjusts difficulty using three signals:
                                            correct answer streaks, response time, and skill-specific performance.
                                            The system tracks your accuracy per skill (Algebra, Geometry, etc.) and adapts accordingly.
                                        </p>
                                    </div>

                                    <div>
                                        <h4 className="font-semibold text-lg mb-2">Privacy & Data</h4>
                                        <p className="text-sm">
                                            <strong>No login required</strong> — practice immediately.
                                            Your progress is stored locally in your browser.
                                            No personal data is collected or stored on our servers.
                                        </p>
                                    </div>

                                    <div className="bg-amber-50 border border-amber-200 rounded p-3">
                                        <p className="text-sm text-amber-900">
                                            <strong>⚠️ Important:</strong> AI can make mistakes. Always think critically and verify solutions.
                                            This tool is designed to support learning, not replace it.
                                        </p>
                                    </div>

                                    <div className="pt-2 border-t border-gray-200">
                                        <p className="text-xs text-gray-500">
                                            Built with FastAPI (backend) and React + TypeScript (frontend).
                                            Questions generated using both AI and template-based methods.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                <p className="forge-colophon">No login · 100% free · ink on navy paper</p>
            </div>
        </div>
    )
}

export default App

function ElaborateTutor(props: {
    apiBase: string
    userId: string
    domain: Domain
    skill: Skill
    difficulty: 'easy' | 'medium' | 'hard'
    promptLatex: string
    steps: string[]
    correctAnswer: string
}) {
    const { apiBase, userId, domain, skill, difficulty, promptLatex, steps, correctAnswer } = props
    const [open, setOpen] = useState(false)
    const [q, setQ] = useState('')
    const [loading, setLoading] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    const [resp, setResp] = useState<null | {
        concept?: string
        plan?: string
        walkthrough?: string[]
        quick_check?: string
        common_mistake?: string
    }>(null)

    // Use shared inline math renderer
    const renderInline = (text: string) => renderInlineMathShared(text)

    const submit = async () => {
        if (!q.trim()) return
        setLoading(true)
        setErr(null)
        setResp(null)
        try {
            const body = {
                user_id: userId || 'anonymous',
                domain,
                skill,
                difficulty,
                prompt_latex: promptLatex,
                steps,
                correct_answer: correctAnswer,
                user_question: q.trim(),
            }
            const r = await axios.post<{ elaboration: any }>(`${apiBase}/elaborate`, body)
            setResp(r.data?.elaboration || null)
        } catch (e: any) {
            const status = e?.response?.status
            if (status === 429) {
                setErr('You hit the tutor limit. Please wait a minute and try again.')
            } else {
                const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e))
                setErr(msg)
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="mt-3">
            <button
                className="forge-btn forge-btn-ghost"
                style={{ padding: '0.4rem 0.65rem', fontSize: '0.72rem' }}
                onClick={() => setOpen((v) => !v)}
            >
                {open ? 'Hide tutor' : 'Ask the tutor'}
            </button>
            {open && (
                <div className="mt-2 p-3 border rounded bg-gray-50">
                    <div className="text-xs text-gray-700 mb-1">Ask a follow-up question about this problem:</div>
                    <textarea
                        className="w-full border rounded p-2 text-sm bg-white"
                        rows={3}
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="E.g., Why did we subtract there? Could you show another method?"
                    />
                    <div className="mt-2 flex items-center gap-2">
                        <button
                            className="forge-btn forge-btn-primary"
                            disabled={loading || !q.trim()}
                            onClick={submit}
                        >
                            {loading ? 'Thinking…' : 'Ask'}
                        </button>
                        {err && <span className="text-xs text-rose-700">{err}</span>}
                    </div>
                    {resp && (
                        <div className="mt-3 text-sm space-y-1">
                            {resp.concept && (
                                <div className="bg-purple-100 text-purple-900 px-2 py-1 rounded"><span className="font-semibold">Concept:</span> {renderInline(resp.concept)}</div>
                            )}
                            {resp.plan && (
                                <div className="bg-green-100 text-green-900 px-2 py-1 rounded"><span className="font-semibold">Plan:</span> {renderInline(resp.plan)}</div>
                            )}
                            {Array.isArray(resp.walkthrough) && resp.walkthrough.length > 0 && (
                                <ol className="list-decimal list-inside space-y-1">
                                    {resp.walkthrough.map((w, i) => (
                                        <li key={i}>{renderInline(String(w))}</li>
                                    ))}
                                </ol>
                            )}
                            {resp.quick_check && (
                                <div className="bg-amber-100 text-amber-900 px-2 py-1 rounded"><span className="font-semibold">Quick check:</span> {renderInline(resp.quick_check)}</div>
                            )}
                            {resp.common_mistake && (
                                <div className="bg-pink-100 text-red-900 px-2 py-1 rounded"><span className="font-semibold">Common mistake:</span> {renderInline(resp.common_mistake)}</div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
type RightTriangleProps = { a: number; b: number; c: number; labels: Record<string, string>; showLabels?: boolean }
function RightTriangle({ a, b, labels, showLabels = true }: RightTriangleProps) {
    const maxSide = Math.max(a, b)
    const scale = maxSide > 0 ? 180 / maxSide : 1
    const ax = a * scale
    const by = b * scale
    const width = Math.max(ax + 24, 240)
    const height = Math.max(by + 24, 200)
    const leftX = 12
    const baseY = by + 12
    const hypX2 = ax + 12
    const hypY2 = by + 12
    const hypX1 = 12
    const hypY1 = 12
    const midHX = (hypX1 + hypX2) / 2
    const midHY = (hypY1 + hypY2) / 2
    const labelStyle: React.CSSProperties = {
        paintOrder: 'stroke',
        stroke: '#ffffff',
        strokeWidth: 4,
        strokeLinejoin: 'round',
    }
    return (
        <div className="mb-3">
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="border rounded bg-white">
                <polygon points={`${leftX},${baseY} ${hypX2},${baseY} ${leftX},${hypY1}`} fill="#eef2ff" stroke="#111827" />
                {showLabels && (
                    <>
                        <text x={leftX + ax / 2} y={baseY - 6} textAnchor="middle" fontSize="14" fill="#111827" style={labelStyle}>
                            {labels.a ?? 'a'}
                        </text>
                        <text x={leftX + 10} y={hypY1 + by / 2} textAnchor="start" fontSize="14" fill="#111827" style={labelStyle}>
                            {labels.b ?? 'b'}
                        </text>
                        <text x={midHX - 6} y={midHY - 6} fontSize="14" fill="#111827" style={labelStyle}>
                            {labels.c ?? 'c'}
                        </text>
                    </>
                )}
                <polyline points={`${leftX},${baseY} ${leftX + 12},${baseY} ${leftX + 12},${baseY - 12}`} fill="none" stroke="#111827" />
            </svg>
            <div className="mt-1 text-xs text-gray-600 flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                    <svg width="18" height="12"><polyline points={`0,12 12,12 12,0`} fill="none" stroke="#111827" /></svg>
                    Right angle
                </span>
            </div>
        </div>
    )
}

type TriangleDiagramProps = { spec: NonNullable<GenerateResponse['diagram']>; showLabels: boolean }
function TriangleDiagram({ spec, showLabels }: TriangleDiagramProps) {
    // Simple construction: if points provided, use them; else place A at (40,160), B at (220,160), compute C by ASA or heuristic
    const width = 280
    const height = 200
    let A: [number, number] = [40, 160]
    let B: [number, number] = [220, 160]
    let C: [number, number] = [130, 40]
    if (spec.points && spec.points.A && spec.points.B && spec.points.C) {
        A = spec.points.A
        B = spec.points.B
        C = spec.points.C
    }
    const labels = spec.labels || {}
    const labelStyle: React.CSSProperties = { paintOrder: 'stroke', stroke: '#fff', strokeWidth: 4, strokeLinejoin: 'round' }
    const drawAngleArc = (at: 'A' | 'B' | 'C', style: string, radius = 16) => {
        const p = at === 'A' ? A : at === 'B' ? B : C
        const r = Math.max(10, Math.min(24, radius))
        if (style === 'right') {
            const s = Math.max(8, Math.min(18, r - 4))
            const d = `M ${p[0]} ${p[1]} m 0 ${-s} l ${s} 0 l 0 ${s}`
            return <path d={d} fill="none" stroke="#111827" />
        }
        const count = style === 'double' ? 2 : style === 'triple' ? 3 : 1
        const gap = 3
        const arcs: ReactNode[] = []
        for (let i = 0; i < count; i++) {
            const rr = r - i * gap
            const d = `M ${p[0] + rr} ${p[1]} A ${rr} ${rr} 0 0 0 ${p[0]} ${p[1] - rr}`
            arcs.push(<path key={`arc-${at}-${i}`} d={d} fill="none" stroke="#111827" />)
        }
        return <g>{arcs}</g>
    }
    const drawTicks = (side: 'a' | 'b' | 'c', count: 1 | 2 | 3) => {
        // sides: a=BC, b=AC, c=AB
        const mid = (P: [number, number], Q: [number, number]) => [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2] as [number, number]
        const perp = (P: [number, number], Q: [number, number], len: number) => {
            const dx = Q[0] - P[0], dy = Q[1] - P[1]
            const L = Math.hypot(dx, dy) || 1
            return [-dy / L * len, dx / L * len] as [number, number]
        }
        const seg = side === 'a' ? [B, C] : side === 'b' ? [A, C] : [A, B]
        const m = mid(seg[0], seg[1])
        const off = perp(seg[0], seg[1], 6)
        const lines: ReactNode[] = []
        for (let i = 0; i < count; i++) {
            const shift = (i - (count - 1) / 2) * 6
            const p1: [number, number] = [m[0] - off[0] + shift, m[1] - off[1] + shift]
            const p2: [number, number] = [m[0] + off[0] + shift, m[1] + off[1] + shift]
            lines.push(<line key={`${side}-${i}`} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="#111827" />)
        }
        return lines
    }
    const hasRight = Boolean(spec.angleMarkers?.some((m) => String(m.style) === 'right'))
    const hasMultiArcs = Boolean(spec.angleMarkers?.some((m) => ['double', 'triple'].includes(String(m.style))))
    return (
        <div className="mb-1">
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="border rounded bg-white">
                <polygon points={`${A[0]},${A[1]} ${B[0]},${B[1]} ${C[0]},${C[1]}`} fill="#eef2ff" stroke="#111827" />
                {spec.angleMarkers?.map((m, i) => (
                    <g key={`am-${i}`}>{drawAngleArc(m.at as any, String(m.style), Number(m.radius) || 16)}</g>
                ))}
                {spec.sideTicks?.map((t, i) => (
                    <g key={`t-${i}`}>{drawTicks(t.side as any, Math.max(1, Math.min(3, Number(t.count) || 1)) as 1 | 2 | 3)}</g>
                ))}
                {showLabels && (
                    <>
                        <text x={A[0] - 8} y={A[1] + 16} fontSize="14" fill="#111827" style={labelStyle}>{labels.A ?? 'A'}</text>
                        <text x={B[0] + 6} y={B[1] + 16} fontSize="14" fill="#111827" style={labelStyle}>{labels.B ?? 'B'}</text>
                        <text x={C[0] - 6} y={C[1] - 8} fontSize="14" fill="#111827" style={labelStyle}>{labels.C ?? 'C'}</text>
                    </>
                )}
            </svg>
            <div className="mt-1 text-xs text-gray-600 flex items-center gap-3 flex-wrap">
                {hasRight && (
                    <span className="inline-flex items-center gap-1">
                        <svg width="18" height="12"><polyline points={`0,12 12,12 12,0`} fill="none" stroke="#111827" /></svg>
                        Right angle
                    </span>
                )}
                {hasMultiArcs && (
                    <span className="inline-flex items-center gap-1">
                        <svg width="18" height="12">
                            <path d={`M 12 12 A 6 6 0 0 0 6 6`} fill="none" stroke="#111827" />
                            <path d={`M 12 12 A 9 9 0 0 0 3 3`} fill="none" stroke="#111827" />
                        </svg>
                        Equal angles
                    </span>
                )}
                {Boolean(spec.sideTicks && spec.sideTicks.length) && (
                    <span className="inline-flex items-center gap-1">
                        <svg width="18" height="12"><line x1="4" y1="10" x2="14" y2="2" stroke="#111827" /><line x1="9" y1="7" x2="9" y2="5" stroke="#111827" /></svg>
                        Equal sides
                    </span>
                )}
            </div>
        </div>
    )
}
