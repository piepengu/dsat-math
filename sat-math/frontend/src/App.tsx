import axios from 'axios'
import 'katex/dist/katex.min.css'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BlockMath } from 'react-katex'
import './App.css'
import { renderInlineMath as renderInlineMathShared } from './utils/latex'
import { getCached, setCached, invalidateCache, CACHE_KEYS } from './utils/cache'

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
    const [inSession, setInSession] = useState(false)
    const [sessionLen, setSessionLen] = useState(10)
    const [questionIdx, setQuestionIdx] = useState(0)
    const [numCorrect, setNumCorrect] = useState(0)
    const [estimate, setEstimate] = useState<{ score: number; ci68: [number, number] } | null>(null)
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
        if (error.includes('timeout')) return 'Request timed out. Please try again.'
        if (error.includes('404')) return 'Service unavailable. Please try again later.'
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
        setResult(null)
        setAnswer('')
        setSelectedIdx(null)
        setChoices(null)
        setLastError(null)
        setAiCorrectIndex(null)
        setAiExplanation(null)
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
        // Stop timer immediately when submitting
        setStartTs(null)
        setLoading(true)
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
                            time_ms: startTs ? Math.max(0, Date.now() - startTs) : undefined,
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
                if (startTs) payload.time_ms = Math.max(0, Date.now() - startTs)
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
        }
    }

    useEffect(() => {
        // initial question
        void loadQuestion()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div className="min-h-screen bg-gray-200 text-gray-900">
            <div className="max-w-3xl mx-auto p-6">
                {/* Debug banner removed for production; keep a hidden error node to satisfy TS usage */}
                {lastError && (
                    <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
                        ⚠️ {formatError(lastError)}
                    </div>
                )}
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-2xl font-semibold text-blue-600">DSAT Math Forge</h2>
                    <a
                        className="text-sm text-indigo-700 hover:underline"
                        href="formulas.html"
                        target="_blank"
                        rel="noopener"
                        aria-label="Open formula sheet"
                    >
                        Formula sheet
                    </a>
                </div>
                <div className="bg-white border border-gray-300 rounded-lg p-4 mb-4 shadow-sm">
                    <div className="flex flex-wrap gap-2 items-center mb-3">
                    <select
                        className="border rounded px-3 py-2 bg-white"
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
                    <label className="flex items-center gap-2 text-sm text-gray-700 ml-2">
                        <input
                            type="checkbox"
                            className="accent-indigo-600"
                            checked={useAI}
                            onChange={(e) => setUseAI(e.target.checked)}
                        />
                        Use AI
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700 ml-2">
                        <input
                            type="checkbox"
                            className="accent-emerald-600"
                            checked={adaptive}
                            onChange={(e) => setAdaptive(e.target.checked)}
                        />
                        Adaptive mode
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700 ml-2">
                        Difficulty:
                        <select
                            className="border rounded px-2 py-1 bg-white disabled:opacity-60"
                            value={difficulty}
                            onChange={(e) => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
                            disabled={adaptive}
                        >
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                        </select>
                    </label>
                    <select
                        className="border rounded px-3 py-2 bg-white"
                        value={skill}
                        onChange={(e) => setSkill(e.target.value as Skill)}
                    >
                        {allowedSkills.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                    </select>
                    <button
                        className="inline-flex items-center px-3 py-2 rounded bg-indigo-600 text-gray-800 hover:bg-indigo-700 disabled:opacity-50 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        disabled={loading || inSession}
                        onClick={() => {
                            setEstimate(null)
                            setQuestionIdx(0)
                            setNumCorrect(0)
                            setInSession(false)
                            void loadQuestion()
                        }}
                    >
                        {loading ? (
                            <>
                                <span className="animate-spin mr-2">⏳</span>
                                {useAI ? (
                                    <>
                                        Generating...
                                        {aiGenStartTs && (
                                            <span className="ml-2 text-xs opacity-75">
                                                (~{Math.max(0, Math.round((Date.now() - aiGenStartTs) / 1000))}s / ~30s)
                                            </span>
                                        )}
                                    </>
                                ) : (
                                    'Loading...'
                                )}
                            </>
                        ) : (
                            '🔄 New question'
                        )}
                    </button>
                    <div className="ml-auto text-xs text-gray-500">User: {userId || '...'}</div>
                </div>
                </div>

                <div className="bg-white border border-gray-300 rounded-lg p-4 mb-4 shadow-sm">
                    <div className="flex flex-wrap gap-2 items-center">
                        <label className="text-sm text-gray-700">
                            Session size:
                            <input
                                type="number"
                                min={1}
                                max={44}
                                value={sessionLen}
                                onChange={(e) => setSessionLen(parseInt(e.target.value || '1', 10))}
                                className="ml-2 w-20 border rounded px-2 py-1"
                                disabled={inSession}
                            />
                        </label>
                        <button
                            className="inline-flex items-center px-3 py-2 rounded bg-emerald-600 text-gray-800 hover:bg-emerald-700 disabled:opacity-50 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                            disabled={loading || inSession}
                            onClick={async () => {
                                setEstimate(null)
                                setQuestionIdx(0)
                                setNumCorrect(0)
                                setInSession(true)
                                await loadQuestion()
                            }}
                        >
                            Start session
                        </button>
                        {(inSession || adaptive) && (
                            <div className="text-sm text-gray-600">
                                {inSession && (
                                    <>Q {questionIdx + 1} / {sessionLen} · Correct: {numCorrect}</>
                                )}
                                {adaptive && (
                                    <span className="ml-2 text-emerald-700">Adaptive: {difficulty}</span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                {inSession && (
                    <div className="w-full h-2 bg-gray-200 rounded mb-3">
                        <div className="h-2 bg-blue-600 rounded" style={{ width: `${((questionIdx + 1) / sessionLen) * 100}%` }} />
                    </div>
                )}

                {latex && (
                    <div className="bg-white border border-gray-200 rounded-md shadow-sm p-5 mb-3 whitespace-pre-wrap">
                        {useAI
                            ? (() => {
                                const norm = normalizeLatex(latex)
                                const plain = maybeRenderPlainText(norm)
                                if (plain) return plain
                                // Handle block math delimiters \[ ... \]
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
                            })()
                            : (() => {
                                const norm = normalizeLatex(latex)
                                const plain = maybeRenderPlainText(norm)
                                if (plain) return plain
                                // Handle block math delimiters \[ ... \]
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
                            })()}
                    </div>
                )}

                {/* live timer */}
                {startTs != null && result == null && (
                    <div className="text-sm text-gray-600 mb-2">Time: {(((nowTs - (startTs || nowTs)) / 1000)).toFixed(1)}s</div>
                )}

                {/* hints */}
                {(hints && hints.length > 0) && (
                    <div className="mb-3">
                        <button
                            className="inline-flex items-center px-3 py-1.5 rounded bg-amber-200 text-amber-900 hover:bg-amber-300 text-sm"
                            onClick={() => setHintsShown((n) => Math.min(hints.length, n + 1))}
                            disabled={hintsShown >= hints.length}
                        >
                            {hintsShown >= hints.length ? 'All hints shown' : 'Need a hint?'}
                        </button>
                        {hintsShown > 0 && (
                            <ul className="mt-2 list-disc list-inside text-sm text-gray-800 space-y-1">
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
                            <label className="text-sm text-gray-700 flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    className="accent-indigo-600"
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

                <div className="flex flex-wrap items-center gap-2">
                    {choices && choices.length > 0 ? (
                        <div className="flex flex-col gap-2 w-full">
                            {(() => {
                                const resolvedCorrectIdx = useAI && aiCorrectIndex != null
                                    ? aiCorrectIndex
                                    : (result && choices ? choices.findIndex((cc) => cc === result.correct_answer) : -1)
                                return choices.map((c, idx) => {
                                    let base = 'flex items-center gap-3 p-3 border rounded hover:bg-gray-50 '
                                    if (result) {
                                        if (idx === resolvedCorrectIdx) base += 'border-emerald-600 bg-emerald-50 '
                                        else if (selectedIdx === idx && !result.correct) base += 'border-red-600 bg-red-50 '
                                        else base += 'border-gray-300 '
                                    } else {
                                        base += selectedIdx === idx ? 'border-indigo-600 bg-indigo-50 ' : 'border-gray-300 '
                                    }
                                    return (
                                        <label key={idx} className={base}>
                                            <input
                                                type="radio"
                                                className="accent-indigo-600"
                                                name="mc"
                                                checked={selectedIdx === idx}
                                                onChange={() => setSelectedIdx(idx)}
                                                disabled={!!result}
                                            />
                                            <span className="flex items-center gap-2">{renderInlineMath(c)}</span>
                                            {result && idx === resolvedCorrectIdx && (
                                                <span className="ml-2 text-xs text-emerald-700">(Correct)</span>
                                            )}
                                            {result && selectedIdx === idx && !result.correct && (
                                                <span className="ml-2 text-xs text-red-700">(Your choice)</span>
                                            )}
                                        </label>
                                    )
                                })
                            })()}
                        </div>
                    ) : (
                        <input
                            ref={answerInputRef}
                            className="border border-gray-300 rounded px-3 py-2 flex-1 min-w-[220px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                        className="inline-flex items-center px-4 py-2 rounded bg-indigo-600 text-gray-800 hover:bg-indigo-700 disabled:opacity-50 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        disabled={loading || seed == null}
                        onClick={submit}
                    >
                        Submit
                    </button>
                    {inSession && result && (
                        <button
                            className="inline-flex items-center px-4 py-2 rounded bg-slate-700 text-gray-800 hover:bg-slate-800 disabled:opacity-50 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
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
                    <div className="mt-3">
                        <div className={`font-semibold ${result.correct ? 'text-emerald-700' : 'text-red-700'}`}>
                            {result.correct ? 'Correct' : 'Incorrect'}
                        </div>
                        {!result.correct && result.why_incorrect_selected && (
                            <div className="mt-1 text-sm text-red-700">Why selected option is wrong: {result.why_incorrect_selected}</div>
                        )}
                        <button
                            className="mt-2 text-sm text-indigo-700 hover:underline"
                            onClick={() => setExplanationOpen((v) => !v)}
                        >
                            {explanationOpen ? 'Hide explanation' : 'Show explanation'}
                        </button>
                        {explanationOpen && (
                            <div className="mt-2">
                                <div className="text-sm text-gray-700">Correct answer: {result.correct_answer}</div>
                                <div className="flex items-center gap-3 mt-2">
                                    <div className="font-semibold">Explanation</div>
                                    <div className="flex flex-wrap gap-1 text-xs">
                                        {result.explanation?.concept && (
                                            <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">Concept</span>
                                        )}
                                        {result.explanation?.plan && (
                                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">Plan</span>
                                        )}
                                        {result.explanation?.quick_check && (
                                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800">Quick check</span>
                                        )}
                                        {result.explanation?.common_mistake && (
                                            <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800">Common mistake</span>
                                        )}
                                    </div>
                                    <button
                                        className="ml-auto text-xs text-gray-700 hover:underline"
                                        onClick={async () => {
                                            const parts: string[] = []
                                            if (result.explanation?.concept) parts.push(`Concept: ${result.explanation.concept}`)
                                            if (result.explanation?.plan) parts.push(`Plan: ${result.explanation.plan}`)
                                            result.explanation_steps.forEach((s, i) => parts.push(`${i + 1}. ${s}`))
                                            if (result.explanation?.quick_check) parts.push(`Quick check: ${result.explanation.quick_check}`)
                                            if (result.explanation?.common_mistake) parts.push(`Common mistake: ${result.explanation.common_mistake}`)
                                            const text = parts.join('\n')
                                            try {
                                                await navigator.clipboard.writeText(text)
                                            } catch {
                                                // no-op
                                            }
                                        }}
                                    >
                                        Copy explanation
                                    </button>
                                </div>
                                {/* Elaborate AI tutor */}
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
                                {result.explanation && (
                                    <div className="mb-2 text-sm text-gray-800 space-y-1">
                                        {result.explanation.concept && (
                                            <div><span className="font-semibold">Concept:</span> {renderInlineMath(result.explanation.concept)}</div>
                                        )}
                                        {result.explanation.plan && (
                                            <div><span className="font-semibold">Plan:</span> {renderInlineMath(result.explanation.plan)}</div>
                                        )}
                                    </div>
                                )}
                                <ol className="list-decimal list-inside space-y-1">
                                    {result.explanation_steps.map((s, i) => (
                                        <li key={i}>{renderInlineMath(s)}</li>
                                    ))}
                                </ol>
                                {result.explanation && (
                                    <div className="mt-2 text-sm text-gray-800 space-y-1">
                                        {result.explanation.quick_check && (
                                            <div><span className="font-semibold">Quick check:</span> {renderInlineMath(result.explanation.quick_check)}</div>
                                        )}
                                        {result.explanation.common_mistake && (
                                            <div className="text-amber-800"><span className="font-semibold">Common mistake:</span> {renderInlineMath(result.explanation.common_mistake)}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {!inSession && missed.length > 0 && (
                    <div className="mt-6 p-4 border border-gray-200 rounded-md bg-white">
                        <div className="font-semibold mb-2">Review missed questions</div>
                        <ul className="space-y-2">
                            {missed.map((m, idx) => (
                                <li key={idx} className="flex items-center justify-between gap-3">
                                    <div className="text-sm text-gray-700">
                                        {m.domain} · {m.skill} · {m.difficulty}
                                    </div>
                                    <button
                                        className="inline-flex items-center px-3 py-1.5 rounded bg-indigo-600 text-gray-800 hover:bg-indigo-700 text-sm"
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
                                className="inline-flex items-center px-3 py-1.5 rounded bg-slate-700 text-gray-800 hover:bg-slate-800 text-sm"
                                onClick={() => setMissed([])}
                            >
                                Clear review list
                            </button>
                        </div>
                    </div>
                )}

                {estimate && (
                    <div className="mt-4 p-4 border border-gray-200 rounded-md bg-white">
                        <div className="font-bold">Estimated SAT Math score</div>
                        <div className="text-2xl">
                            {estimate.score}{' '}
                            <span className="text-sm text-gray-600">(68% CI {estimate.ci68[0]}–{estimate.ci68[1]})</span>
                        </div>
                        <div className="mt-2 text-sm text-gray-700">
                            Start another session or continue practicing individual questions.
                        </div>
                    </div>
                )}

                <div className="mt-4 bg-white border border-gray-300 rounded-lg p-4 shadow-sm">
                    <div className="flex flex-wrap gap-2 items-center">
                    <button
                        className="inline-flex items-center px-3 py-2 rounded bg-indigo-600 text-gray-800 hover:bg-indigo-700 disabled:opacity-50 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
                        📊 My Stats
                    </button>
                    <button
                        className="ml-2 inline-flex items-center px-3 py-2 rounded bg-emerald-600 text-gray-800 hover:bg-emerald-700 disabled:opacity-50 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
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
                        {streaksLoading ? 'Loading…' : '🔥 My Streaks'}
                    </button>
                    <button
                        className="ml-2 inline-flex items-center px-3 py-2 rounded bg-purple-600 text-gray-800 hover:bg-purple-700 disabled:opacity-50 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
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
                        {achievementsLoading ? 'Loading…' : '🏆 My Achievements'}
                    </button>
                    <button
                        className="ml-2 inline-flex items-center px-3 py-2 rounded bg-rose-600 text-gray-800 hover:bg-rose-700 disabled:opacity-50 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
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
                        🗑️ Reset my stats
                    </button>
                    </div>
                    {stats && statsOpen && (
                        <div className="mt-4 p-4 border border-gray-200 rounded-md bg-white shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                                <div className="font-semibold">📊 My Stats</div>
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
                                <table className="w-full mt-2 border-collapse">
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
                            )}

                            {/* Per-difficulty breakdown if provided by backend */}
                            {showByDifficulty && Boolean((stats as any).__by_difficulty) && (
                                <table className="w-full mt-4 border-collapse">
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
                            )}

                            {/* Per-source breakdown (AI vs template) */}
                            {Boolean((stats as any).__by_source) && (
                                <table className="w-full mt-4 border-collapse">
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
                                                Object.entries(srcMap).map(([src, v]) => (
                                                    <tr key={`${sk}-${src}`} className="border-b last:border-0">
                                                        <td className="p-2">{sk}</td>
                                                        <td className="p-2 capitalize">{src}</td>
                                                        <td className="text-right p-2">{(v as any).attempts}</td>
                                                        <td className="text-right p-2">{(v as any).correct}</td>
                                                        <td className="text-right p-2">{Math.round(((v as any).accuracy || 0) * 100)}%</td>
                                                        <td className="text-right p-2">{(v as any).avg_time_s ? `${((v as any).avg_time_s as number).toFixed(1)}s` : '-'}</td>
                                                    </tr>
                                                ))
                                            )}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}
                    {streaks && streaksOpen && (
                        <div className="mt-4 p-4 border border-gray-200 rounded-md bg-white shadow-sm">
                            <div className="flex items-center justify-between mb-2">
                                <div className="font-semibold">🔥 My Streak</div>
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
                                <div className="font-semibold">🏆 My Achievements</div>
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
                className="inline-flex items-center px-2 py-1.5 rounded bg-sky-200 text-sky-900 hover:bg-sky-300 text-xs"
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
                            className="inline-flex items-center px-3 py-1.5 rounded bg-indigo-600 text-gray-800 hover:bg-indigo-700 disabled:opacity-50 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 text-sm"
                            disabled={loading || !q.trim()}
                            onClick={submit}
                        >
                            {loading ? 'Thinking…' : 'Ask'}
                        </button>
                        {err && <span className="text-xs text-rose-700">{err}</span>}
                    </div>
                    {resp && (
                        <div className="mt-3 text-sm text-gray-800 space-y-1">
                            {resp.concept && (
                                <div><span className="font-semibold">Concept:</span> {renderInline(resp.concept)}</div>
                            )}
                            {resp.plan && (
                                <div><span className="font-semibold">Plan:</span> {renderInline(resp.plan)}</div>
                            )}
                            {Array.isArray(resp.walkthrough) && resp.walkthrough.length > 0 && (
                                <ol className="list-decimal list-inside space-y-1">
                                    {resp.walkthrough.map((w, i) => (
                                        <li key={i}>{renderInline(String(w))}</li>
                                    ))}
                                </ol>
                            )}
                            {resp.quick_check && (
                                <div><span className="font-semibold">Quick check:</span> {renderInline(resp.quick_check)}</div>
                            )}
                            {resp.common_mistake && (
                                <div className="text-amber-800"><span className="font-semibold">Common mistake:</span> {renderInline(resp.common_mistake)}</div>
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
