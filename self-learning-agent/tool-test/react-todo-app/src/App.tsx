import { useState, useEffect, useRef } from 'react'
import './App.css'

interface Todo {
  id: number
  text: string
  completed: boolean
  createdAt: number
}

type FilterType = 'all' | 'active' | 'completed'

function App() {
  const [todos, setTodos] = useState<Todo[]>(() => {
    const saved = localStorage.getItem('todos')
    return saved ? JSON.parse(saved) : []
  })
  const [inputValue, setInputValue] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [removingIds, setRemovingIds] = useState<Set<number>>(new Set())
  const [addingIds, setAddingIds] = useState<Set<number>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem('todos', JSON.stringify(todos))
  }, [todos])

  useEffect(() => {
    if (editingId !== null && editRef.current) {
      editRef.current.focus()
    }
  }, [editingId])

  const addTodo = () => {
    const text = inputValue.trim()
    if (!text) return
    const newTodo: Todo = {
      id: Date.now(),
      text,
      completed: false,
      createdAt: Date.now(),
    }
    setAddingIds(prev => new Set(prev).add(newTodo.id))
    setTodos(prev => [newTodo, ...prev])
    setInputValue('')
    inputRef.current?.focus()
    setTimeout(() => {
      setAddingIds(prev => {
        const next = new Set(prev)
        next.delete(newTodo.id)
        return next
      })
    }, 400)
  }

  const removeTodo = (id: number) => {
    setRemovingIds(prev => new Set(prev).add(id))
    setTimeout(() => {
      setTodos(prev => prev.filter(t => t.id !== id))
      setRemovingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 300)
  }

  const toggleTodo = (id: number) => {
    setTodos(prev =>
      prev.map(t => (t.id === id ? { ...t, completed: !t.completed } : t))
    )
  }

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id)
    setEditText(todo.text)
  }

  const saveEdit = (id: number) => {
    const text = editText.trim()
    if (text) {
      setTodos(prev => prev.map(t => (t.id === id ? { ...t, text } : t)))
    }
    setEditingId(null)
    setEditText('')
  }

  const clearCompleted = () => {
    const completedIds = todos.filter(t => t.completed).map(t => t.id)
    completedIds.forEach(id => {
      setRemovingIds(prev => new Set(prev).add(id))
    })
    setTimeout(() => {
      setTodos(prev => prev.filter(t => !t.completed))
      setRemovingIds(new Set())
    }, 300)
  }

  const filteredTodos = todos.filter(t => {
    if (filter === 'active') return !t.completed
    if (filter === 'completed') return t.completed
    return true
  })

  const activeCount = todos.filter(t => !t.completed).length
  const completedCount = todos.filter(t => t.completed).length
  const totalCount = todos.length

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') addTodo()
  }

  const handleEditKeyDown = (e: React.KeyboardEvent, id: number) => {
    if (e.key === 'Enter') saveEdit(id)
    if (e.key === 'Escape') {
      setEditingId(null)
      setEditText('')
    }
  }

  return (
    <div className="app-container">
      <div className="app-card">
        <header className="app-header">
          <h1>📝 Todo List</h1>
          <p className="subtitle">管理你的日常任务</p>
        </header>

        <div className="input-section">
          <input
            ref={inputRef}
            type="text"
            className="todo-input"
            placeholder="添加新任务..."
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button className="add-btn" onClick={addTodo}>
            添加
          </button>
        </div>

        <div className="stats-bar">
          <div className="stat-item">
            <span className="stat-number">{totalCount}</span>
            <span className="stat-label">全部</span>
          </div>
          <div className="stat-item active">
            <span className="stat-number">{activeCount}</span>
            <span className="stat-label">进行中</span>
          </div>
          <div className="stat-item completed">
            <span className="stat-number">{completedCount}</span>
            <span className="stat-label">已完成</span>
          </div>
        </div>

        <div className="filter-bar">
          <button
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            全部
          </button>
          <button
            className={`filter-btn ${filter === 'active' ? 'active' : ''}`}
            onClick={() => setFilter('active')}
          >
            进行中
          </button>
          <button
            className={`filter-btn ${filter === 'completed' ? 'active' : ''}`}
            onClick={() => setFilter('completed')}
          >
            已完成
          </button>
          {completedCount > 0 && (
            <button className="clear-btn" onClick={clearCompleted}>
              清除已完成
            </button>
          )}
        </div>

        <ul className="todo-list">
          {filteredTodos.length === 0 && (
            <li className="empty-state">
              {filter === 'all'
                ? '暂无任务，添加一个吧！'
                : filter === 'active'
                ? '没有进行中的任务'
                : '没有已完成的任务'}
            </li>
          )}
          {filteredTodos.map(todo => (
            <li
              key={todo.id}
              className={`todo-item ${todo.completed ? 'completed' : ''} ${
                removingIds.has(todo.id) ? 'removing' : ''
              } ${addingIds.has(todo.id) ? 'adding' : ''}`}
            >
              <label className="checkbox-wrapper">
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => toggleTodo(todo.id)}
                />
                <span className="checkmark"></span>
              </label>

              {editingId === todo.id ? (
                <input
                  ref={editRef}
                  type="text"
                  className="edit-input"
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => handleEditKeyDown(e, todo.id)}
                  onBlur={() => saveEdit(todo.id)}
                />
              ) : (
                <span
                  className="todo-text"
                  onDoubleClick={() => startEdit(todo)}
                >
                  {todo.text}
                </span>
              )}

              <div className="todo-actions">
                {editingId !== todo.id && (
                  <button
                    className="action-btn edit-btn"
                    onClick={() => startEdit(todo)}
                    title="编辑"
                  >
                    ✏️
                  </button>
                )}
                <button
                  className="action-btn delete-btn"
                  onClick={() => removeTodo(todo.id)}
                  title="删除"
                >
                  🗑️
                </button>
              </div>
            </li>
          ))}
        </ul>

        <footer className="app-footer">
          <p>双击任务可编辑 · 数据自动保存至本地</p>
        </footer>
      </div>
    </div>
  )
}

export default App
