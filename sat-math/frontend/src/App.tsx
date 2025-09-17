import axios from 'axios'
import 'katex/dist/katex.min.css'
import { useEffect, useMemo, useState } from 'react'
import { BlockMath } from 'react-katex'
import './App.css'

type Domain = 'Algebra' | 'PSD' | 'Advanced' | 'Geometry'
type Skill =
    | 'linear_equation'
    | 'linear_equation_mc'
    | 'two_step_equation'
    | 'proportion'
    | 'linear_system_2x2'
    | 'quadratic_roots'
    | 'exponential_solve'
    | 'pythagorean_hypotenuse'
    | 'pythagorean_leg'

type GenerateResponse = {
    domain: string
    skill: string
    format: string
    seed: number
    prompt_latex: string
    choices?: string[]
}

type GradeResponse = {
    correct: boolean
    correct_answer: string
    explanation_steps: string[]
    why_correct?: string
    why_incorrect_selected?: string
}

function App() {
    const [domain, setDomain] = useState<Domain>('Algebra')
    const [skill, setSkill] = useState<Skill>('linear_equation')
    const [seed, setSeed] = useState<number | null>(null)
    const [latex, setLatex] = useState<string>('')
    const [choices, setChoices] = useState<string[] | null>(null)
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

    const apiBase = useMemo(() => {
        // Change if backend runs elsewhere
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
        try {
            const resp = await axios.post<GenerateResponse>(`${apiBase}/generate`, {
                domain,
                skill,
            })
            setLatex(resp.data.prompt_latex)
            setSeed(resp.data.seed)
            setChoices(resp.data.choices ?? null)
        } finally {
            setLoading(false)
        }
    }

    const submit = async () => {
        if (seed == null) return
        setLoading(true)
        try {
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
            const resp = await axios.post<GradeResponse>(`${apiBase}/grade`, payload)
            setResult(resp.data)
            if (inSession) {
                setNumCorrect((c) => c + (resp.data.correct ? 1 : 0))
            }
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
        <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
            <h2>DSAT Math Practice</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <select value={domain} onChange={(e) => setDomain(e.target.value as Domain)}>
                    <option value="Algebra">Algebra</option>
                    <option value="PSD">Problem Solving & Data Analysis</option>
                    <option value="Advanced">Advanced Math</option>
                    <option value="Geometry">Geometry & Trig</option>
                </select>
                <select value={skill} onChange={(e) => setSkill(e.target.value as Skill)}>
                    <option value="linear_equation">Linear equation</option>
                    <option value="linear_equation_mc">Linear equation (MC)</option>
                    <option value="two_step_equation">Two-step equation</option>
                    <option value="proportion">Proportion</option>
                    <option value="linear_system_2x2">2x2 system</option>
                    <option value="quadratic_roots">Quadratic roots</option>
                    <option value="exponential_solve">Exponential solve</option>
                    <option value="pythagorean_hypotenuse">Pythagorean hypotenuse</option>
                    <option value="pythagorean_leg">Pythagorean leg</option>
                </select>
                <button
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
                <div style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.8 }}>
                    User: {userId || '...'}
                </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <label>
                    Session size:
                    <input
                        type="number"
                        min={1}
                        max={44}
                        value={sessionLen}
                        onChange={(e) => setSessionLen(parseInt(e.target.value || '1', 10))}
                        style={{ width: 64, marginLeft: 6 }}
                        disabled={inSession}
                    />
                </label>
                <button
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
                    <div style={{ fontSize: 14 }}>
                        Q {questionIdx + 1} / {sessionLen} · Correct: {numCorrect}
                    </div>
                )}
            </div>

            {latex && (
                <div style={{ padding: 12, border: '1px solid #ddd', borderRadius: 8, marginBottom: 12 }}>
                    <BlockMath math={latex} />
                </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {choices && choices.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                        {choices.map((c, idx) => (
                            <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                    type="radio"
                                    name="mc"
                                    checked={selectedIdx === idx}
                                    onChange={() => setSelectedIdx(idx)}
                                />
                                <span>{c}</span>
                            </label>
                        ))}
                    </div>
                ) : (
                    <input
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        placeholder="Enter your answer"
                    />
                )}
                <button disabled={loading || seed == null} onClick={submit}>Submit</button>
                {inSession && result && (
                    <button
                        disabled={loading}
                        onClick={async () => {
                            // advance to next or finish
                            const nextIdx = questionIdx + 1
                            if (nextIdx >= sessionLen) {
                                // finish: request estimate
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
                <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 600, color: result.correct ? 'green' : 'crimson' }}>
                        {result.correct ? 'Correct' : 'Incorrect'}
                    </div>
                    <div>Correct answer: {result.correct_answer}</div>
                    {!result.correct && result.why_incorrect_selected && (
                        <div style={{ marginTop: 6, color: '#a33' }}>Why selected option is wrong: {result.why_incorrect_selected}</div>
                    )}
                    <div style={{ marginTop: 8 }}>
                        <div style={{ fontWeight: 600 }}>Explanation</div>
                        <ol>
                            {result.explanation_steps.map((s, i) => (
                                <li key={i}>{s}</li>
                            ))}
                        </ol>
                    </div>
                </div>
            )}

            {estimate && (
                <div style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
                    <div style={{ fontWeight: 700 }}>Estimated SAT Math score</div>
                    <div style={{ fontSize: 24 }}>
                        {estimate.score} <span style={{ fontSize: 14 }}>(68% CI {estimate.ci68[0]}–{estimate.ci68[1]})</span>
                    </div>
                    <div style={{ marginTop: 8 }}>
                        Start another session or continue practicing individual questions.
                    </div>
                </div>
            )}

            <div style={{ marginTop: 16 }}>
                <button
                    disabled={loading || !userId}
                    onClick={async () => {
                        setLoading(true)
                        try {
                            const resp = await axios.get<Record<string, { attempts: number; correct: number; accuracy: number }>>(
                                `${apiBase}/stats`,
                                { params: { user_id: userId } }
                            )
                            setStats(resp.data)
                        } finally {
                            setLoading(false)
                        }
                    }}
                >
                    My Stats
                </button>
                {stats && (
                    <table style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 4 }}>Skill</th>
                                <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 4 }}>Attempts</th>
                                <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 4 }}>Correct</th>
                                <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 4 }}>Accuracy</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(stats).map(([sk, v]) => (
                                <tr key={sk}>
                                    <td style={{ padding: 4 }}>{sk}</td>
                                    <td style={{ textAlign: 'right', padding: 4 }}>{v.attempts}</td>
                                    <td style={{ textAlign: 'right', padding: 4 }}>{v.correct}</td>
                                    <td style={{ textAlign: 'right', padding: 4 }}>{Math.round(v.accuracy * 100)}%</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}

export default App
