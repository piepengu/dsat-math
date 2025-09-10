import axios from 'axios'
import 'katex/dist/katex.min.css'
import { useEffect, useMemo, useState } from 'react'
import { BlockMath } from 'react-katex'
import './App.css'

type Domain = 'Algebra' | 'PSD'
type Skill = 'linear_equation' | 'two_step_equation' | 'proportion' | 'linear_system_2x2'

type GenerateResponse = {
    domain: string
    skill: string
    format: string
    seed: number
    prompt_latex: string
}

type GradeResponse = {
    correct: boolean
    correct_answer: string
    explanation_steps: string[]
    why_correct?: string
}

function App() {
    const [domain, setDomain] = useState<Domain>('Algebra')
    const [skill, setSkill] = useState<Skill>('linear_equation')
    const [seed, setSeed] = useState<number | null>(null)
    const [latex, setLatex] = useState<string>('')
    const [answer, setAnswer] = useState('')
    const [result, setResult] = useState<GradeResponse | null>(null)
    const [loading, setLoading] = useState(false)

    const apiBase = useMemo(() => {
        // Change if backend runs elsewhere
        return 'http://127.0.0.1:8000'
    }, [])

    const loadQuestion = async () => {
        setLoading(true)
        setResult(null)
        setAnswer('')
        try {
            const resp = await axios.post<GenerateResponse>(`${apiBase}/generate`, {
                domain,
                skill,
            })
            setLatex(resp.data.prompt_latex)
            setSeed(resp.data.seed)
        } finally {
            setLoading(false)
        }
    }

    const submit = async () => {
        if (seed == null) return
        setLoading(true)
        try {
            const resp = await axios.post<GradeResponse>(`${apiBase}/grade`, {
                domain,
                skill,
                seed,
                user_answer: answer,
            })
            setResult(resp.data)
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
                </select>
                <select value={skill} onChange={(e) => setSkill(e.target.value as Skill)}>
                    <option value="linear_equation">Linear equation</option>
                    <option value="two_step_equation">Two-step equation</option>
                    <option value="proportion">Proportion</option>
                    <option value="linear_system_2x2">2x2 system</option>
                </select>
                <button disabled={loading} onClick={loadQuestion}>New question</button>
            </div>

            {latex && (
                <div style={{ padding: 12, border: '1px solid #ddd', borderRadius: 8, marginBottom: 12 }}>
                    <BlockMath math={latex} />
                </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Enter your answer"
                />
                <button disabled={loading || seed == null} onClick={submit}>Submit</button>
            </div>

            {result && (
                <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 600, color: result.correct ? 'green' : 'crimson' }}>
                        {result.correct ? 'Correct' : 'Incorrect'}
                    </div>
                    <div>Correct answer: {result.correct_answer}</div>
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
        </div>
    )
}

export default App
