import axios from 'axios'
import 'katex/dist/katex.min.css'
import { useEffect, useMemo, useState } from 'react'
import { BlockMath, InlineMath } from 'react-katex'
import './App.css'

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
    } | null
}

type GradeResponse = {
    correct: boolean
    correct_answer: string
    explanation_steps: string[]
    why_correct?: string
    why_incorrect_selected?: string
}

type GenerateAIResponse = {
    prompt_latex: string
    choices: string[]
    correct_index: number
    explanation_steps: string[]
    diagram?: GenerateResponse['diagram']
}

function App() {
    const APP_BUILD = 'c25cf92'
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
    const [aiCorrectIndex, setAiCorrectIndex] = useState<number | null>(null)
    const [aiExplanation, setAiExplanation] = useState<string[] | null>(null)
    const [explanationOpen, setExplanationOpen] = useState<boolean>(true)
    const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium')
    const [startTs, setStartTs] = useState<number | null>(null)
    const [nowTs, setNowTs] = useState<number>(Date.now())
    const [labelsOn, setLabelsOn] = useState<boolean>(true)

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

    const renderInlineMath = (text: string) =>
        text.split(/(\$[^$]+\$)/g).map((seg, i) => {
            if (seg.startsWith('$') && seg.endsWith('$')) {
                return <InlineMath key={i} math={seg.slice(1, -1)} />
            }
            // Clean common LaTeX spacing commands accidentally left in plain text
            const cleaned = seg.replace(/\\\s/g, ' ').replace(/\\,/g, ' ')
            return <span key={i}>{cleaned}</span>
        })

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
        // If there are environments or obvious math macros but no $ delimiters, render as block
        if (/\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\}/.test(text)) return true
        const hasMathMacros = /(\\frac|\\sqrt|\\sum|\\int|\\left|\\right|\\begin|\\end|\^|_)/.test(text)
        const hasDelimiters = /\$[^$]+\$|\$\$[\s\S]*?\$\$/.test(text)
        return hasMathMacros && !hasDelimiters
    }

    const renderWithEnvironments = (text: string) => {
        const envRe = /(\\begin\{[^}]+\}[\s\S]*?\\end\{[^}]+\})/g
        const parts = text.split(envRe)
        return parts.map((seg, i) =>
            envRe.test(seg)
                ? (
                    <div key={`env-${i}`} className="my-2">
                        <BlockMath math={seg} />
                    </div>
                )
                : (
                    <span key={`txt-${i}`}>{renderInlineMath(seg)}</span>
                )
        )
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
            if (useAI) {
                const resp = await axios.post<GenerateAIResponse>(`${apiBase}/generate_ai`, {
                    domain,
                    skill,
                    difficulty,
                })
                setLatex(resp.data.prompt_latex)
                setSeed(-1) // AI items are not seeded
                setChoices(resp.data.choices)
                setAiCorrectIndex(resp.data.correct_index)
                setAiExplanation(resp.data.explanation_steps)
                setDiagram(resp.data.diagram ?? null)
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
                setLabelsOn((resp.data.diagram as any)?.showLabels ?? true)
            }
            setStartTs(Date.now())
            setNowTs(Date.now())
        } catch (e: any) {
            const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e))
            setLastError(msg)
        } finally {
            setLoading(false)
        }
    }

    // Live timer tick while a question is active
    useEffect(() => {
        const active = startTs != null && result == null
        if (!active) return
        const id = setInterval(() => setNowTs(Date.now()), 250)
        return () => clearInterval(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startTs, result])

    const submit = async () => {
        if (seed == null) return
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
                })
                if (inSession) setNumCorrect((c) => c + (correct ? 1 : 0))
                // Persist AI attempt for stats
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
                    })
                } catch (e) {
                    // ignore logging errors
                }
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
                const resp = await axios.post<GradeResponse>(`${apiBase}/grade`, payload)
                setResult(resp.data)
                if (inSession) setNumCorrect((c) => c + (resp.data.correct ? 1 : 0))
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
        <div className="min-h-screen bg-gray-50 text-gray-900">
            <div className="max-w-3xl mx-auto p-6">
                <div className="mb-2 p-2 text-xs rounded border bg-yellow-50 text-yellow-900">
                    <div>API base: {apiBase || '(not set, using 127.0.0.1 fallback)'} · Build: {APP_BUILD}</div>
                    {lastError && <div className="mt-1">Last error: {lastError}</div>}
                </div>
                <h2 className="text-2xl font-semibold mb-3">DSAT Math Practice</h2>
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
                        Difficulty:
                        <select
                            className="border rounded px-2 py-1 bg-white"
                            value={difficulty}
                            onChange={(e) => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
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
                        New question
                    </button>
                    <div className="ml-auto text-xs text-gray-500">User: {userId || '...'}</div>
                </div>

                <div className="flex items-center gap-3 mb-3">
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
                    {inSession && (
                        <div className="text-sm text-gray-600">
                            Q {questionIdx + 1} / {sessionLen} · Correct: {numCorrect}
                        </div>
                    )}
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
                            className="border border-gray-300 rounded px-3 py-2 flex-1 min-w-[220px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            value={answer}
                            onChange={(e) => setAnswer(e.target.value)}
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
                                <div className="font-semibold mt-2">Explanation</div>
                                <ol className="list-decimal list-inside space-y-1">
                                    {result.explanation_steps.map((s, i) => (
                                        <li key={i}>{s}</li>
                                    ))}
                                </ol>
                            </div>
                        )}
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

                <div className="mt-4">
                    <button
                        className="inline-flex items-center px-3 py-2 rounded bg-slate-700 text-gray-800 hover:bg-slate-800 disabled:opacity-50 shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                        disabled={loading || !userId}
                        onClick={async () => {
                            setLoading(true)
                            try {
                                const resp = await axios.get<Record<string, { attempts: number; correct: number; accuracy: number }>>(
                                    `${apiBase}/stats`,
                                    { params: { user_id: userId } }
                                )
                                setStats(resp.data)
                            } catch (e: any) {
                                const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || String(e))
                                setLastError(msg)
                            } finally {
                                setLoading(false)
                            }
                        }}
                    >
                        My Stats
                    </button>
                    {stats && (
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
                                {Object.entries(stats).map(([sk, v]) => (
                                    <tr key={sk} className="border-b last:border-0">
                                        <td className="p-2">{sk}</td>
                                        <td className="text-right p-2">{v.attempts}</td>
                                        <td className="text-right p-2">{v.correct}</td>
                                        <td className="text-right p-2">{Math.round(v.accuracy * 100)}%</td>
                                        <td className="text-right p-2">{(v as any).avg_time_s ? `${((v as any).avg_time_s as number).toFixed(1)}s` : '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    )
}

export default App

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
        // Draw a simple quarter/arc marker; keep generic for now
        const r = Math.max(10, Math.min(24, radius))
        const d = `M ${p[0] + r} ${p[1]} A ${r} ${r} 0 0 0 ${p[0]} ${p[1] - r}`
        return <path d={d} fill="none" stroke="#111827" />
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
        const lines = [] as JSX.Element[]
        for (let i = 0; i < count; i++) {
            const shift = (i - (count - 1) / 2) * 6
            const p1: [number, number] = [m[0] - off[0] + shift, m[1] - off[1] + shift]
            const p2: [number, number] = [m[0] + off[0] + shift, m[1] + off[1] + shift]
            lines.push(<line key={`${side}-${i}`} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="#111827" />)
        }
        return lines
    }
    return (
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
    )
}
