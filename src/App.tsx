import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Plus,
  MessageSquare,
  Settings,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Download,
  User,
  Sparkles,
  Search,
  SidebarClose,
  SidebarOpen,
  FolderLock,
  Globe,
  LogOut,
  X
} from 'lucide-react';
import { marked } from 'marked';
import './App.css';

interface SessionItem {
  id: string;
  title: string;
  created_at: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  created_at: string;
}

interface PipelineStep {
  name: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  details?: string;
}

interface PipelineState {
  task_id: string;
  task_name?: string;
  status: string;
  steps: PipelineStep[];
  download_link: string | null;
  result?: string | null;
  error: string | null;
  timestamp: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export default function App() {
  // Auth State
  const [email, setEmail] = useState<string>(() => localStorage.getItem('user_email') || '');
  const [name, setName] = useState<string>(() => localStorage.getItem('user_name') || '');
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => !!localStorage.getItem('user_email'));

  // Theme State
  const [selectedTheme, setSelectedTheme] = useState<'purple' | 'green' | 'amber'>(
    () => (localStorage.getItem('theme') as any) || 'purple'
  );

  // Settings Panel Open
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  // Desktop Experience Popup
  const [showDesktopPopup, setShowDesktopPopup] = useState(true);

  // Sidebar search filter
  const [searchQuery, setSearchQuery] = useState('');

  // Sidebar Open/Collapse State
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Right Panel (Pipelines & Files) Open/Collapse State
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  // Modal Login Input State
  const [inputEmail, setInputEmail] = useState('');
  const [inputName, setInputName] = useState('');

  // App States
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(
    () => localStorage.getItem('active_session_id') || null
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('Vanshu is thinking... 🤖');

  // Active Pipeline (polls latest queued Celery chain)
  const [activePipeline, setActivePipeline] = useState<PipelineState | null>(null);

  // Document/Pipeline History drawer (stores all pipelines run in this session)
  const [pipelinesList, setPipelinesList] = useState<PipelineState[]>([]);

  // Task Hub Open
  const [showTaskHubModal, setShowTaskHubModal] = useState(false);

  // Task Hub Search query
  const [taskSearchQuery, setTaskSearchQuery] = useState('');

  // Refs for scrolling
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Parse marked options safely
  useEffect(() => {
    marked.setOptions({
      gfm: true,
      breaks: true
    });
  }, []);

  // Update theme configurations in local storage
  useEffect(() => {
    localStorage.setItem('theme', selectedTheme);
  }, [selectedTheme]);

  // Scroll to bottom on new messages or pipeline updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activePipeline]);

  // Load user sessions and tasks when logged in
  useEffect(() => {
    if (isLoggedIn && email) {
      fetchSessions();
      fetchUserTasks();
    }
  }, [isLoggedIn, email]);

  // Load chat history when session changes
  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem('active_session_id', currentSessionId);
      fetchHistory(currentSessionId);
    } else {
      localStorage.removeItem('active_session_id');
      setMessages([]);
      setActivePipeline(null);
    }
  }, [currentSessionId]);

  // Global listener to copy code snippets
  useEffect(() => {
    const handleCopyClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('code-copy-btn')) {
        const pre = target.closest('pre');
        const code = pre?.querySelector('code');
        if (code) {
          navigator.clipboard.writeText(code.innerText);
          const originalText = target.innerText;
          target.innerText = 'Copied! ✓';
          setTimeout(() => {
            target.innerText = originalText;
          }, 2000);
        }
      }
    };
    document.addEventListener('click', handleCopyClick);
    return () => document.removeEventListener('click', handleCopyClick);
  }, []);

  // Dynamically inject "Copy" button overlays to rendered codeblocks
  useEffect(() => {
    const preElements = document.querySelectorAll('.markdown-body pre');
    preElements.forEach((pre) => {
      if (!pre.querySelector('.code-copy-btn')) {
        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.innerText = 'Copy';
        pre.appendChild(btn);
      }
    });
  }, [messages]);

  // Cycle through descriptive status messages while loading
  useEffect(() => {
    if (!isLoading) {
      setStatusText('Vanshu is thinking... 🤖');
      return;
    }

    const statuses = [
      { time: 0, text: 'Vanshu is thinking... 🤖' },
      { time: 5000, text: 'Vanshu is planning the workflow... 📋' },
      { time: 15000, text: 'Vanshu is coordinating agents... 🔗' },
      { time: 30000, text: 'Vanshu is executing tools... ⚡' },
      { time: 45000, text: 'Vanshu is finalizing task... ✨' }
    ];

    const timers = statuses.map(status => {
      return setTimeout(() => {
        setStatusText(status.text);
      }, status.time);
    });

    return () => {
      timers.forEach(t => clearTimeout(t));
    };
  }, [isLoading]);

  // Polling active Celery tasks status
  useEffect(() => {
    if (!activePipeline || activePipeline.status === 'completed' || activePipeline.status === 'failed') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/task/${activePipeline.task_id}`);
        if (!res.ok) return;
        const taskData = await res.json();

        const status = taskData.status.toLowerCase();
        const resultText = taskData.result || '';

        let steps: PipelineStep[] = [
          { name: 'Research Intelligence', status: 'pending' },
          { name: 'Document Structuring', status: 'pending' },
          { name: 'Cloud Upload (R2)', status: 'pending' },
          { name: 'Email Delivery (Gmail)', status: 'pending' }
        ];

        if (status === 'pending') {
          steps[0].status = 'active';
          steps[0].details = 'Searching web databases...';
        } else if (status === 'processing' || status === 'started') {
          if (resultText.includes('creating') || resultText.includes('docx') || resultText.includes('pdf') || resultText.includes('slides')) {
            steps[0].status = 'completed';
            steps[1].status = 'active';
            steps[1].details = resultText || 'Compiling document layout...';
          } else if (resultText.includes('Uploading') || resultText.includes('R2')) {
            steps[0].status = 'completed';
            steps[1].status = 'completed';
            steps[2].status = 'active';
            steps[2].details = 'Uploading binary artifact...';
          } else if (resultText.includes('sending') || resultText.includes('email') || resultText.includes('Email')) {
            steps[0].status = 'completed';
            steps[1].status = 'completed';
            steps[2].status = 'completed';
            steps[3].status = 'active';
            steps[3].details = 'Delivering to your inbox...';
          } else {
            steps[0].status = 'active';
            steps[0].details = resultText || 'Executing background tasks...';
          }
        } else if (status === 'completed' || status === 'success') {
          steps[0].status = 'completed';
          steps[1].status = 'completed';
          steps[2].status = 'completed';
          steps[3].status = 'completed';
        } else if (status === 'failed' || status === 'failure') {
          steps.forEach(step => {
            if (step.status === 'active' || step.status === 'pending') {
              step.status = 'failed';
              step.details = resultText;
            }
          });
        }

        const updatedPipeline: PipelineState = {
          ...activePipeline,
          status,
          steps,
          download_link: taskData.download_link || null,
          error: status === 'failed' ? resultText : null
        };

        // Update both active pipeline & history database
        setActivePipeline(updatedPipeline);
        setPipelinesList(prev =>
          prev.map(p => p.task_id === activePipeline.task_id ? updatedPipeline : p)
        );

        if (status === 'completed' || status === 'failed') {
          clearInterval(interval);
          if (currentSessionId) {
            fetchHistory(currentSessionId);
          }
          fetchUserTasks(); // 🟢 Refresh historical tasks dashboard
        }
      } catch (err) {
        console.error('Error polling task status:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activePipeline, currentSessionId]);

  const fetchUserTasks = async () => {
    if (!email) return;
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/all/${encodeURIComponent(email)}`);
      if (res.ok) {
        const data = await res.json();
        const tasks = data.map((t: any) => {
          const status = t.status.toLowerCase();
          let steps: PipelineStep[] = [
            { name: 'Research Intelligence', status: status === 'completed' ? 'completed' : 'pending' },
            { name: 'Document Structuring', status: status === 'completed' ? 'completed' : 'pending' },
            { name: 'Cloud Upload (R2)', status: status === 'completed' ? 'completed' : 'pending' },
            { name: 'Email Delivery (Gmail)', status: status === 'completed' ? 'completed' : 'pending' }
          ];

          return {
            task_id: t.task_id,
            task_name: t.task_name || 'Background Task',
            status: status,
            steps: steps,
            download_link: t.download_link || null,
            result: t.result || null,
            error: status === 'failed' ? t.result : null,
            timestamp: new Date(t.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
          };
        });

        setPipelinesList(tasks);

        // Auto-resume active polling if there's any running task
        const runningTask = tasks.find((t: any) => t.status !== 'completed' && t.status !== 'failed');
        if (runningTask && (!activePipeline || activePipeline.task_id !== runningTask.task_id)) {
          setActivePipeline(runningTask);
        }
      }
    } catch (err) {
      console.error('Error fetching user tasks:', err);
    }
  };

  const extractTaskId = (content: string): string | null => {
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = content.match(uuidRegex);
    return match ? match[0] : null;
  };

  const cleanTaskName = (name?: string) => {
    if (!name) return 'Background Task';
    if (name.includes('create_pdf_task')) return '📄 Generate PDF Document';
    if (name.includes('create_docx_task')) return '📝 Compile Word Brief';
    if (name.includes('render_slides_task')) return '📊 Create Presentation';
    if (name.includes('send_email_task')) return '✉️ Send Gmail Email';
    if (name.includes('draft_email_task')) return '📨 Draft Gmail Email';
    if (name.includes('research_task')) return '🔍 Web Research Pipeline';
    return name;
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/sessions/${encodeURIComponent(email)}`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error('Error fetching sessions:', err);
    }
  };

  const fetchHistory = async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/history/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);

        // 🟢 Scan history messages for Celery Task IDs and fetch their status
        const extractedPipelines: PipelineState[] = [];
        for (const msg of data) {
          if (msg.role === 'assistant') {
            const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
            const match = msg.content.match(uuidRegex);
            if (match) {
              const taskId = match[0];
              try {
                const taskRes = await fetch(`${API_BASE_URL}/task/${taskId}`);
                if (taskRes.ok) {
                  const taskData = await taskRes.json();
                  const status = taskData.status.toLowerCase();

                  let steps: PipelineStep[] = [
                    { name: 'Research Intelligence', status: status === 'completed' ? 'completed' : 'pending' },
                    { name: 'Document Structuring', status: status === 'completed' ? 'completed' : 'pending' },
                    { name: 'Cloud Upload (R2)', status: status === 'completed' ? 'completed' : 'pending' },
                    { name: 'Email Delivery (Gmail)', status: status === 'completed' ? 'completed' : 'pending' }
                  ];

                  extractedPipelines.push({
                    task_id: taskId,
                    status: status,
                    steps: steps,
                    download_link: taskData.download_link || null,
                    result: taskData.result || null,
                    error: status === 'failed' ? taskData.result : null,
                    timestamp: new Date(taskData.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                  });
                }
              } catch (err) {
                console.error('Error fetching pipeline for task:', taskId, err);
              }
            }
          }
        }
        setPipelinesList(extractedPipelines);
      }
    } catch (err) {
      console.error('Error fetching history:', err);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputEmail.trim()) return;

    const userEmail = inputEmail.trim().toLowerCase();
    const userName = inputName.trim() || 'User';

    localStorage.setItem('user_email', userEmail);
    localStorage.setItem('user_name', userName);

    setEmail(userEmail);
    setName(userName);
    setIsLoggedIn(true);
  };

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    localStorage.setItem('user_email', email.trim().toLowerCase());
    localStorage.setItem('user_name', name.trim());
    setShowSettingsModal(false);
    fetchSessions();
  };

  const handleLogout = () => {
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_name');
    localStorage.removeItem('active_session_id');
    setEmail('');
    setName('');
    setIsLoggedIn(false);
    setSessions([]);
    setCurrentSessionId(null);
    setMessages([]);
    setActivePipeline(null);
    setPipelinesList([]);
    setShowSettingsModal(false);
  };

  const handleNewChat = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setActivePipeline(null);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isLoading) return;

    const userMessageContent = prompt;
    setPrompt('');
    setIsLoading(true);

    const tempUserMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userMessageContent,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const res = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          name,
          prompt: userMessageContent,
          session_id: currentSessionId
        })
      });

      if (!res.ok) {
        throw new Error('Server returned an error');
      }

      const data = await res.json();

      if (!currentSessionId && data.session_id) {
        setCurrentSessionId(data.session_id);
        fetchSessions();
      }

      if (data.task_id) {
        const newPipeline: PipelineState = {
          task_id: data.task_id,
          status: 'pending',
          steps: [
            { name: 'Research Intelligence', status: 'active', details: 'Triggering background agents...' },
            { name: 'Document Structuring', status: 'pending' },
            { name: 'Cloud Upload (R2)', status: 'pending' },
            { name: 'Email Delivery (Gmail)', status: 'pending' }
          ],
          download_link: null,
          result: null,
          error: null,
          timestamp: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        };

        setActivePipeline(newPipeline);
        setPipelinesList(prev => [newPipeline, ...prev]);
        setRightPanelOpen(true); // Automatically expand pipelines drawer
        fetchUserTasks(); // 🟢 Refresh task list from backend

        const tempAssistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.response,
          created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, tempAssistantMsg]);
      } else {
        const tempAssistantMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.response,
          created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, tempAssistantMsg]);
        setActivePipeline(null);
      }

    } catch (err: any) {
      console.error(err);
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `⚠️ Failed to reach assistant: ${err.message || 'Unknown error'}. Please verify backend configuration.`,
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  // Client-side search filtering for historical chats
  const filteredSessions = sessions.filter(s =>
    s.title?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div id="app-container" className={`theme-${selectedTheme}`}>
      {/* Background glow animations */}
      <div className="bg-glow-primary"></div>
      <div className="bg-glow-secondary"></div>

      {/* Profile login modal (first-time users) */}
      {!isLoggedIn && (
        <div className="modal-backdrop">
          <div className="modal-content glass-panel">
            <div className="modal-header">
              <div className="modal-logo">
                <Sparkles size={22} />
              </div>
              <h2>Welcome to Vanshu AI</h2>
              <p>Your modular AI orchestrator and background document compiler.</p>
            </div>

            <form onSubmit={handleLogin} className="modal-form">
              <div className="form-group">
                <label htmlFor="user-email">Email Address</label>
                <input
                  type="email"
                  id="user-email"
                  className="modal-input glass-input"
                  placeholder="name@example.com"
                  value={inputEmail}
                  onChange={e => setInputEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="user-name">Your Name</label>
                <input
                  type="text"
                  id="user-name"
                  className="modal-input glass-input"
                  placeholder="Sumit"
                  value={inputName}
                  onChange={e => setInputName(e.target.value)}
                />
              </div>

              <button type="submit" className="modal-submit glass-btn">
                Get Started
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Settings Panel Modal */}
      {showSettingsModal && (
        <div className="modal-backdrop">
          <div className="modal-content glass-panel">
            <div className="modal-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div className="modal-logo">
                <Settings size={20} />
              </div>
              <h2>Settings & Customization</h2>
              <p>Manage your account parameters and UI appearance.</p>
            </div>

            <form onSubmit={handleUpdateProfile} className="modal-form">
              <div className="form-group">
                <label>Profile Name</label>
                <input
                  type="text"
                  className="modal-input glass-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email"
                  className="modal-input glass-input"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>

              {/* Theme customizer */}
              <div className="theme-selector-group">
                <label>Appearance Theme</label>
                <div className="theme-options">
                  <button
                    type="button"
                    className={`theme-option-btn ${selectedTheme === 'purple' ? 'active' : ''}`}
                    onClick={() => setSelectedTheme('purple')}
                  >
                    🪐 Deep Purple
                  </button>
                  <button
                    type="button"
                    className={`theme-option-btn ${selectedTheme === 'green' ? 'active' : ''}`}
                    onClick={() => setSelectedTheme('green')}
                  >
                    🌿 Emerald
                  </button>
                  <button
                    type="button"
                    className={`theme-option-btn ${selectedTheme === 'amber' ? 'active' : ''}`}
                    onClick={() => setSelectedTheme('amber')}
                  >
                    🔥 Solar Amber
                  </button>
                </div>
              </div>

              <button type="submit" className="modal-submit glass-btn">
                Save & Apply Changes
              </button>

              <button
                type="button"
                onClick={handleLogout}
                className="glass-btn"
                style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171' }}
              >
                <LogOut size={14} /> Log Out / Reset Local Cache
              </button>

              <button type="button" className="settings-close-btn" onClick={() => setShowSettingsModal(false)}>
                Close Settings
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Tasks & Pipelines Dashboard Modal */}
      {showTaskHubModal && (() => {
        const filteredTasks = pipelinesList.filter(pipe =>
          pipe.task_id.toLowerCase().includes(taskSearchQuery.toLowerCase()) ||
          (pipe.task_name && pipe.task_name.toLowerCase().includes(taskSearchQuery.toLowerCase()))
        );

        return (
          <div className="task-hub-backdrop">
            <div className="task-hub-content glass-panel">
              <div className="modal-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div className="modal-logo">
                  <FolderLock size={20} />
                </div>
                <h2>Tasks & Execution Hub</h2>
                <p>View the real-time execution status and compiled results for all background Celery tasks triggered in this session.</p>
              </div>

              {/* Task search filter */}
              <div className="search-container" style={{ margin: '12px auto 8px auto', width: '100%', maxWidth: '400px' }}>
                <Search size={14} className="search-icon" />
                <input
                  type="text"
                  className="sidebar-search-field glass-input"
                  placeholder="Search by Task ID or Type..."
                  value={taskSearchQuery}
                  onChange={e => setTaskSearchQuery(e.target.value)}
                />
              </div>

              <div className="task-hub-table-wrapper">
                {filteredTasks.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                    <Globe size={32} style={{ opacity: 0.3, marginBottom: '12px' }} />
                    <p>No matching tasks found.</p>
                  </div>
                ) : (
                  <table className="task-hub-table">
                    <thead>
                      <tr>
                        <th>Task Type</th>
                        <th>Task ID</th>
                        <th>Status</th>
                        <th>Triggered Time</th>
                        <th>Result / Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.map(pipe => (
                        <tr key={pipe.task_id}>
                          <td style={{ fontWeight: '500', color: '#fff' }}>
                            {cleanTaskName(pipe.task_name)}
                          </td>
                          <td>
                            <div className="task-id-cell">
                              <span>{pipe.task_id.substring(0, 16)}...</span>
                              <button
                                className="task-copy-btn"
                                onClick={() => {
                                  navigator.clipboard.writeText(pipe.task_id);
                                }}
                              >
                                Copy
                              </button>
                            </div>
                          </td>
                          <td>
                            <span className={`pipeline-badge ${pipe.status}`}>
                              {pipe.status.toUpperCase()}
                            </span>
                          </td>
                          <td>{pipe.timestamp}</td>
                          <td>
                            {pipe.download_link ? (
                              <a
                                href={pipe.download_link}
                                target="_blank"
                                rel="noreferrer"
                                className="download-btn glass-btn"
                                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                              >
                                <Download size={12} /> Download
                              </a>
                            ) : pipe.status === 'completed' || pipe.status === 'success' ? (
                              <span style={{ color: '#a7f3d0', fontSize: '0.8rem' }}>{pipe.result || 'Success'}</span>
                            ) : pipe.status === 'failed' ? (
                              <span style={{ color: '#ef4444', fontSize: '0.75rem' }}>Failed</span>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#64748b' }}>
                                <Loader2 size={12} className="spin-slow" style={{ animation: 'spin-slow 2s linear infinite' }} /> Running
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="glass-btn" onClick={() => setShowTaskHubModal(false)}>
                  Close Dashboard
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Desktop Experience Popup */}
      {showDesktopPopup && (
        <div className="modal-backdrop desktop-popup-backdrop">
          <div className="modal-content glass-panel desktop-popup-content">
            <button
              className="desktop-popup-close"
              onClick={() => setShowDesktopPopup(false)}
              title="Close"
            >
              <X size={18} />
            </button>
            <div className="modal-header">
              <div className="modal-logo">
                <Sparkles size={22} />
              </div>
              <h2>💻 Desktop Experience</h2>
              <p>For the best experience, we recommend using Vanshu AI on a desktop or laptop computer with a larger screen.</p>
            </div>
            <div className="desktop-popup-features">
              <div className="desktop-popup-feature">
                <span className="desktop-popup-icon">🖥️</span>
                <span>Full sidebar navigation with session history</span>
              </div>
              <div className="desktop-popup-feature">
                <span className="desktop-popup-icon">📋</span>
                <span>Pipelines & Files panel for real-time task tracking</span>
              </div>
              <div className="desktop-popup-feature">
                <span className="desktop-popup-icon">🎨</span>
                <span>Theme customization and settings management</span>
              </div>
              <div className="desktop-popup-feature">
                <span className="desktop-popup-icon">⌨️</span>
                <span>Keyboard shortcuts and efficient multi-tasking</span>
              </div>
            </div>
            <button
              className="modal-submit glass-btn"
              onClick={() => setShowDesktopPopup(false)}
            >
              Got it, Continue
            </button>
          </div>
        </div>
      )}

      {/* Mobile sidebar backdrop overlay - closes sidebar when tapped */}
      <div
        className={`sidebar-backdrop ${sidebarOpen ? 'visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      ></div>

      {/* Left Sidebar Drawer */}
      <aside id="sidebar" className={`glass-panel ${!sidebarOpen ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="bot-avatar">
            <Sparkles size={20} color="#fff" />
          </div>
          <div className="app-title-container">
            <h1>Vanshu AI</h1>
            <p><span className="status-dot"></span> Orchestration Engine</p>
          </div>
          {/* Mobile sidebar close button */}
          <button className="sidebar-mobile-close" onClick={() => setSidebarOpen(false)} title="Close Sidebar">
            <X size={18} />
          </button>
        </div>

        <div className="sidebar-content">
          <button onClick={handleNewChat} className="new-chat-btn glass-btn">
            <Plus size={16} /> New Session
          </button>

          <button onClick={() => setShowTaskHubModal(true)} className="new-chat-btn glass-btn" style={{ marginTop: '8px', border: '1px solid rgba(139, 92, 246, 0.3)', background: 'rgba(139, 92, 246, 0.05)' }}>
            <FolderLock size={16} /> Tasks Dashboard
          </button>

          {/* Search bar inside sidebar */}
          <div className="search-container">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              className="sidebar-search-field glass-input"
              placeholder="Search chat sessions..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          {filteredSessions.length > 0 && <h3 className="session-section-title">Recent Chats</h3>}

          <div className="session-list-scroll">
            {filteredSessions.map(sess => (
              <div
                key={sess.id}
                className={`session-item ${currentSessionId === sess.id ? 'active' : ''}`}
                onClick={() => setCurrentSessionId(sess.id)}
              >
                <MessageSquare size={14} />
                <div className="session-info">
                  <div className="session-title">{sess.title}</div>
                  <div className="session-date">{formatDate(sess.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="user-profile-widget">
            <div className="user-avatar">
              {name.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="user-meta">
              <div className="user-name">{name}</div>
              <div className="user-email">{email}</div>
            </div>
          </div>

          <button onClick={() => setShowSettingsModal(true)} className="settings-trigger" title="Settings">
            <Settings size={18} />
          </button>
        </div>
      </aside>

      {/* Main Chat Hub Container */}
      <main id="chat-container">
        <header className="chat-header glass-panel">
          <div className="chat-header-info">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="sidebar-toggle-btn" title="Toggle Sidebar">
              {sidebarOpen ? <SidebarClose size={16} /> : <SidebarOpen size={16} />}
            </button>
            <div className="chat-header-text">
              <h2>{currentSessionId ? sessions.find(s => s.id === currentSessionId)?.title || 'Active Session' : 'New Session'}</h2>
              <p>Autonomous task compiler, PDF rendering, Cloud storage sync & delivery</p>
            </div>
          </div>

          <div className="chat-header-actions">
            {/* Pipelines toggle button */}
            <button
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              className={`header-action-btn ${rightPanelOpen ? 'active' : ''}`}
              title="Toggle Pipelines drawer"
            >
              <FolderLock size={15} /> Pipelines & Files
            </button>
          </div>
        </header>

        {/* Messaging feed */}
        <div className="messages-list">
          {messages.length === 0 ? (
            <div className="empty-chat">
              <div className="empty-chat-logo">
                <Sparkles size={28} />
              </div>
              <h3>Ask Vanshu Anything</h3>
              <p>
                Request custom intelligence gathering. Ask Vanshu to research subjects, compile clean PDFs/Word briefs, sync them to R2, and deliver them to your email address.
              </p>
              <div style={{ marginTop: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  className="glass-btn"
                  style={{ fontSize: '0.8rem', padding: '8px 14px', borderRadius: '20px' }}
                  onClick={() => setPrompt("Create a research report on clean energy and email it to me")}
                >
                  ⚡ Clean Energy Report
                </button>
                <button
                  className="glass-btn"
                  style={{ fontSize: '0.8rem', padding: '8px 14px', borderRadius: '20px' }}
                  onClick={() => setPrompt("Draft an email introducing our project to hello@agency.com")}
                >
                  ✉️ Draft Intro Email
                </button>
              </div>
            </div>
          ) : (
            messages.map((msg, index) => (
              <div key={msg.id || index} className={`message-row ${msg.role === 'user' ? 'user-row' : 'assistant-row'}`}>
                <div className="message-wrapper">
                  <div className="message-avatar">
                    {msg.role === 'user' ? <User size={14} /> : <Sparkles size={14} />}
                  </div>

                  <div className={`message-container ${msg.role === 'user' ? 'user-msg' : 'assistant-msg'}`}>
                    <div className="message-bubble">
                      <div
                        className="markdown-body"
                        dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) as string }}
                      />

                      {/* Dynamic pipeline stepper tracker (persists inline even after completed/reload) */}
                      {msg.role === 'assistant' && (() => {
                        const taskId = extractTaskId(msg.content);
                        if (!taskId) return null;

                        const pipe = pipelinesList.find(p => p.task_id === taskId);
                        if (!pipe) return null;

                        return (
                          <div className="pipeline-widget">
                            <div className="pipeline-header">
                              <h4>
                                {pipe.status === 'completed' ? (
                                  <CheckCircle2 size={14} color="#10b981" />
                                ) : pipe.status === 'failed' ? (
                                  <AlertCircle size={14} color="#ef4444" />
                                ) : (
                                  <Loader2 size={14} color="var(--theme-accent)" className="spin-slow" style={{ animation: 'spin-slow 2s linear infinite' }} />
                                )}
                                Task ID: {pipe.task_id.substring(0, 8)}...
                              </h4>
                              <span className={`pipeline-badge ${pipe.status}`}>
                                {pipe.status.toUpperCase()}
                              </span>
                            </div>

                            <div className="pipeline-steps">
                              {pipe.steps.map((step, sIdx) => (
                                <div key={sIdx} className={`step-item ${step.status}`}>
                                  <div className="step-icon-wrapper">
                                    {step.status === 'completed' ? '✓' : sIdx + 1}
                                  </div>
                                  <div className="step-content">
                                    <div className="step-label">{step.name}</div>
                                    {step.details && <div className="step-details">{step.details}</div>}
                                  </div>
                                </div>
                              ))}
                            </div>

                            {pipe.download_link && (
                              <div className="pipeline-result">
                                <a
                                  href={pipe.download_link}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="download-btn glass-btn"
                                >
                                  <Download size={14} /> Download Document Artifact
                                </a>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <span className="message-time">{formatDate(msg.created_at)}</span>
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Dynamic typing and planning status loader */}
          {isLoading && (
            <div className="message-row assistant-row">
              <div className="message-wrapper">
                <div className="message-avatar">
                  <Sparkles size={14} />
                </div>
                <div className="message-container assistant-msg">
                  <div className="message-bubble" style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '220px' }}>
                    <div className="status-indicator-text" style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                      {statusText}
                    </div>
                    <div className="typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar Form */}
        <div className="chat-input-wrapper">
          <form onSubmit={handleSendMessage} className="chat-input-form">
            <textarea
              className="chat-input-field glass-input"
              placeholder="Request custom document compilation, research reports, or emails..."
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
              rows={1}
            />
            <button type="submit" className="send-btn glass-btn" disabled={isLoading || !prompt.trim()}>
              {isLoading ? (
                <Loader2 size={16} className="spin-slow" style={{ animation: 'spin-slow 2s linear infinite' }} />
              ) : (
                <Send size={16} />
              )}
            </button>
          </form>
        </div>
      </main>

      {/* Right Drawer: Pipelines & Files Hub */}
      <aside id="right-panel" className={`glass-panel ${!rightPanelOpen ? 'collapsed' : ''}`}>
        <div className="right-panel-header">
          <FolderLock size={16} color="var(--theme-accent)" />
          <h3>Session Pipelines</h3>
        </div>

        <div className="right-panel-content">
          {pipelinesList.length === 0 ? (
            <div className="empty-panel-state">
              <Globe size={24} style={{ opacity: 0.3 }} />
              <p>No active background tasks or files compiled in this session yet.</p>
            </div>
          ) : (
            pipelinesList.map(pipe => (
              <div key={pipe.task_id} className="pipeline-history-card">
                <div className="pipeline-card-header">
                  <span className="pipeline-card-id">Task ID: {pipe.task_id.substring(0, 8)}...</span>
                  <span className={`pipeline-card-status ${pipe.status}`}>{pipe.status.toUpperCase()}</span>
                </div>

                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Triggered at {pipe.timestamp}
                </div>

                {pipe.download_link ? (
                  <a
                    href={pipe.download_link}
                    target="_blank"
                    rel="noreferrer"
                    className="pipeline-card-btn glass-btn"
                  >
                    <Download size={12} /> Download Artifact
                  </a>
                ) : pipe.status === 'failed' ? (
                  <div style={{ fontSize: '0.72rem', color: '#ef4444' }}>
                    Error: Pipeline execution aborted.
                  </div>
                ) : (
                  <div style={{ fontSize: '0.72rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Loader2 size={12} className="spin-slow" style={{ animation: 'spin-slow 2s linear infinite' }} /> Processing pipeline...
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
