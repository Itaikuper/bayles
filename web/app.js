const { useState, useEffect } = React;

// API Helper
const api = {
  get: async (url) => {
    const res = await fetch(`/api${url}`);
    if (!res.ok) throw new Error('API Error');
    return res.json();
  },
  post: async (url, data) => {
    const res = await fetch(`/api${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('API Error');
    return res.json();
  },
  delete: async (url) => {
    const res = await fetch(`/api${url}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('API Error');
    return res.json();
  },
  put: async (url, data) => {
    const res = await fetch(`/api${url}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('API Error');
    return res.json();
  },
};

// Sidebar Component
function Sidebar({ currentPage, setCurrentPage }) {
  const pages = [
    { id: 'dashboard', label: 'דשבורד', icon: '📊' },
    { id: 'control', label: 'שליטה בבוט', icon: '🎮' },
    { id: 'whitelist', label: 'רשימה לבנה', icon: '✅' },
    { id: 'activity', label: 'יומן פעילות', icon: '📋' },
    { id: 'scheduler', label: 'תזמון', icon: '📅' },
    { id: 'groups', label: 'קבוצות', icon: '👥' },
    { id: 'messages', label: 'הודעות', icon: '💬' },
    { id: 'ai', label: 'הגדרות AI', icon: '🤖' },
  ];

  return (
    <div className="sidebar">
      <h1><span>📱</span><span>Bayles</span></h1>
      {pages.map(page => (
        <div
          key={page.id}
          className={`nav-item ${currentPage === page.id ? 'active' : ''}`}
          onClick={() => setCurrentPage(page.id)}
        >
          <span>{page.icon}</span>
          <span>{page.label}</span>
        </div>
      ))}
    </div>
  );
}

// Dashboard Component
function Dashboard() {
  const [stats, setStats] = useState({
    groupCount: 0,
    scheduledCount: 0,
    messagesSentToday: 0,
    isConnected: false,
  });
  const [botStatus, setBotStatus] = useState({ bot_enabled: false });
  const [activityStats, setActivityStats] = useState({ today_total: 0, today_responded: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadStats = async () => {
    try {
      const [data, status, activity] = await Promise.all([
        api.get('/stats'),
        api.get('/bot-control/status'),
        api.get('/bot-control/activity/stats'),
      ]);
      setStats(data);
      setBotStatus(status);
      setActivityStats(activity);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
    setLoading(false);
  };

  if (loading) return <div className="loading">טוען...</div>;

  return (
    <div>
      <div className="header">
        <h2>דשבורד</h2>
        <div className="header-status">
          <div className={`status ${stats.isConnected ? 'connected' : 'disconnected'}`}>
            <span className={`status-dot ${stats.isConnected ? 'connected' : 'disconnected'}`}></span>
            {stats.isConnected ? 'מחובר' : 'מנותק'}
          </div>
          <div className={`status ${botStatus.bot_enabled ? 'connected' : 'disconnected'}`}>
            <span className={`status-dot ${botStatus.bot_enabled ? 'connected' : 'disconnected'}`}></span>
            בוט: {botStatus.bot_enabled ? 'פעיל' : 'כבוי'}
          </div>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <h3>קבוצות</h3>
          <div className="value">{stats.groupCount}</div>
        </div>
        <div className="stat-card">
          <h3>הודעות מתוזמנות</h3>
          <div className="value">{stats.scheduledCount}</div>
        </div>
        <div className="stat-card">
          <h3>הודעות היום</h3>
          <div className="value">{activityStats.today_total}</div>
        </div>
        <div className="stat-card">
          <h3>נענו היום</h3>
          <div className="value">{activityStats.today_responded}</div>
        </div>
      </div>
      <div className="info-box">
        <strong>שקט כברירת מחדל:</strong> הבוט לא יענה לאף אחד אלא אם כן הגדרת זאת ברשימה הלבנה.
      </div>
    </div>
  );
}

// Bot Control Component
function BotControl() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await api.get('/bot-control/settings');
      setSettings(data);
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
    setLoading(false);
  };

  const toggleBot = async () => {
    setSaving(true);
    try {
      const newState = settings.bot_enabled !== 'true';
      await api.post('/bot-control/toggle', { enabled: newState });
      setSettings({ ...settings, bot_enabled: newState ? 'true' : 'false' });
    } catch (err) {
      alert('שגיאה בשינוי מצב הבוט');
    }
    setSaving(false);
  };

  if (loading) return <div className="loading">טוען...</div>;

  const isEnabled = settings.bot_enabled === 'true';

  return (
    <div>
      <div className="header">
        <h2>שליטה בבוט</h2>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>מצב הבוט</h3>
        </div>
        <div className="card-body">
          <div className="bot-toggle-section">
            <div className={`big-status ${isEnabled ? 'on' : 'off'}`}>
              <span className="big-status-icon">{isEnabled ? '🟢' : '🔴'}</span>
              <span className="big-status-text">{isEnabled ? 'פעיל' : 'כבוי'}</span>
            </div>
            <button
              className={`btn ${isEnabled ? 'btn-danger' : 'btn-primary'} btn-large`}
              onClick={toggleBot}
              disabled={saving}
            >
              {saving ? 'משנה...' : (isEnabled ? 'כבה בוט' : 'הפעל בוט')}
            </button>
          </div>
          <div className="info-box">
            <strong>חשוב:</strong> גם אם הבוט פעיל, הוא יענה רק לצ'אטים שהוגדרו ברשימה הלבנה.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>הגדרות נוספות</h3>
        </div>
        <div className="card-body">
          <div className="settings-row">
            <span>תיעוד כל ההודעות:</span>
            <span className={`badge ${settings.log_all_messages === 'true' ? 'badge-success' : 'badge-secondary'}`}>
              {settings.log_all_messages === 'true' ? 'פעיל' : 'כבוי'}
            </span>
          </div>
          <div className="settings-row">
            <span>התנהגות ברירת מחדל:</span>
            <span className="badge badge-info">{settings.default_behavior || 'silent'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Whitelist Component
function Whitelist() {
  const [chats, setChats] = useState([]);
  const [availableGroups, setAvailableGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editChat, setEditChat] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [manualJid, setManualJid] = useState('');
  const [manualName, setManualName] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [chatsData, groupsData] = await Promise.all([
        api.get('/bot-control/chats'),
        api.get('/bot-control/available-groups'),
      ]);
      setChats(chatsData);
      setAvailableGroups(groupsData);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
    setLoading(false);
  };

  const addChat = async (group) => {
    try {
      await api.post('/bot-control/chats', {
        jid: group.id,
        display_name: group.name,
        is_group: true,
        enabled: true,
        ai_mode: 'on',
      });
      loadData();
      setShowAddModal(false);
    } catch (err) {
      alert('שגיאה בהוספת הצ\'אט');
    }
  };

  const addManualChat = async () => {
    if (!manualJid.trim()) {
      alert('יש להזין מספר טלפון');
      return;
    }
    // Format phone number to JID
    let jid = manualJid.trim().replace(/[^0-9]/g, '');
    if (!jid.includes('@')) {
      jid = jid + '@s.whatsapp.net';
    }
    try {
      await api.post('/bot-control/chats', {
        jid: jid,
        display_name: manualName.trim() || jid,
        is_group: false,
        enabled: true,
        ai_mode: 'on',
      });
      setManualJid('');
      setManualName('');
      loadData();
      setShowAddModal(false);
      alert('המספר נוסף בהצלחה!');
    } catch (err) {
      alert('שגיאה בהוספת המספר');
    }
  };

  const toggleChat = async (jid, enabled) => {
    try {
      await api.post(`/bot-control/chats/${encodeURIComponent(jid)}/toggle`, { enabled });
      loadData();
    } catch (err) {
      alert('שגיאה בשינוי מצב הצ\'אט');
    }
  };

  const removeChat = async (jid) => {
    if (!confirm('האם להסיר את הצ\'אט מהרשימה הלבנה?')) return;
    try {
      await api.delete(`/bot-control/chats/${encodeURIComponent(jid)}`);
      loadData();
    } catch (err) {
      alert('שגיאה בהסרת הצ\'אט');
    }
  };

  const updateChat = async () => {
    if (!editChat) return;
    try {
      await api.put(`/bot-control/chats/${encodeURIComponent(editChat.jid)}`, {
        ai_mode: editChat.ai_mode,
        custom_prompt: editChat.custom_prompt || null,
        auto_reply_message: editChat.auto_reply_message || null,
        schedule_enabled: editChat.schedule_enabled ? true : false,
        schedule_start_hour: parseInt(editChat.schedule_start_hour) || 0,
        schedule_end_hour: parseInt(editChat.schedule_end_hour) || 24,
      });
      setEditChat(null);
      loadData();
    } catch (err) {
      alert('שגיאה בעדכון הצ\'אט');
    }
  };

  if (loading) return <div className="loading">טוען...</div>;

  const notAddedGroups = availableGroups.filter(g => !g.in_whitelist);

  return (
    <div>
      <div className="header">
        <h2>רשימה לבנה</h2>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          הוסף קבוצה
        </button>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>צ'אטים מוגדרים ({chats.length})</h3>
        </div>
        <div className="card-body">
          {chats.length === 0 ? (
            <div className="empty-state">אין צ'אטים ברשימה הלבנה. הוסף קבוצות כדי שהבוט יענה להן.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>שם</th>
                  <th>סוג</th>
                  <th>מצב AI</th>
                  <th>סטטוס</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {chats.map(chat => (
                  <tr key={chat.jid}>
                    <td>{chat.display_name || chat.jid}</td>
                    <td>
                      <span className={`badge ${chat.is_group ? 'badge-info' : 'badge-secondary'}`}>
                        {chat.is_group ? 'קבוצה' : 'פרטי'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${chat.ai_mode === 'on' ? 'badge-success' : 'badge-secondary'}`}>
                        {chat.ai_mode === 'on' ? 'פעיל' : 'כבוי'}
                      </span>
                    </td>
                    <td>
                      <button
                        className={`btn btn-small ${chat.enabled ? 'btn-success' : 'btn-secondary'}`}
                        onClick={() => toggleChat(chat.jid, !chat.enabled)}
                      >
                        {chat.enabled ? 'מופעל' : 'מושבת'}
                      </button>
                    </td>
                    <td>
                      <button className="btn btn-small btn-primary" onClick={() => setEditChat({...chat})}>
                        ערוך
                      </button>
                      <button className="btn btn-small btn-danger" onClick={() => removeChat(chat.jid)}>
                        הסר
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add Group Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>הוסף לרשימה לבנה</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="add-section">
                <h4>הוסף מספר טלפון</h4>
                <div className="form-group">
                  <label>מספר טלפון (כולל קידומת מדינה)</label>
                  <input
                    type="text"
                    placeholder="972501234567"
                    value={manualJid}
                    onChange={e => setManualJid(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>שם (אופציונלי)</label>
                  <input
                    type="text"
                    placeholder="שם איש הקשר"
                    value={manualName}
                    onChange={e => setManualName(e.target.value)}
                  />
                </div>
                <button className="btn btn-primary" onClick={addManualChat}>
                  הוסף מספר
                </button>
              </div>

              <hr style={{margin: '20px 0', borderColor: '#eee'}} />

              <div className="add-section">
                <h4>הוסף קבוצה</h4>
                {notAddedGroups.length === 0 ? (
                  <div className="empty-state">כל הקבוצות כבר ברשימה הלבנה</div>
                ) : (
                  <div className="group-list">
                    {notAddedGroups.map(group => (
                      <div key={group.id} className="group-item" onClick={() => addChat(group)}>
                        <span>{group.name}</span>
                        <button className="btn btn-small btn-primary">הוסף</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Chat Modal */}
      {editChat && (
        <div className="modal-overlay" onClick={() => setEditChat(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>עריכת: {editChat.display_name || editChat.jid}</h3>
              <button className="modal-close" onClick={() => setEditChat(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>מצב AI</label>
                <select
                  value={editChat.ai_mode}
                  onChange={e => setEditChat({...editChat, ai_mode: e.target.value})}
                >
                  <option value="on">פעיל - יענה עם AI</option>
                  <option value="off">כבוי - הודעה אוטומטית בלבד</option>
                </select>
              </div>
              {editChat.ai_mode === 'on' && (
                <div className="form-group">
                  <label>Prompt מותאם (אופציונלי)</label>
                  <textarea
                    value={editChat.custom_prompt || ''}
                    onChange={e => setEditChat({...editChat, custom_prompt: e.target.value})}
                    placeholder="השאר ריק לשימוש ב-Prompt הגלובלי..."
                  />
                </div>
              )}
              {editChat.ai_mode === 'off' && (
                <div className="form-group">
                  <label>הודעת מענה אוטומטית</label>
                  <textarea
                    value={editChat.auto_reply_message || ''}
                    onChange={e => setEditChat({...editChat, auto_reply_message: e.target.value})}
                    placeholder="הודעה שתישלח אוטומטית..."
                  />
                </div>
              )}
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={editChat.schedule_enabled}
                    onChange={e => setEditChat({...editChat, schedule_enabled: e.target.checked})}
                  />
                  הגבלת שעות פעילות
                </label>
              </div>
              {editChat.schedule_enabled && (
                <div className="form-row">
                  <div className="form-group">
                    <label>משעה</label>
                    <input
                      type="number"
                      min="0"
                      max="23"
                      value={editChat.schedule_start_hour}
                      onChange={e => setEditChat({...editChat, schedule_start_hour: e.target.value})}
                    />
                  </div>
                  <div className="form-group">
                    <label>עד שעה</label>
                    <input
                      type="number"
                      min="1"
                      max="24"
                      value={editChat.schedule_end_hour}
                      onChange={e => setEditChat({...editChat, schedule_end_hour: e.target.value})}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditChat(null)}>ביטול</button>
              <button className="btn btn-primary" onClick={updateChat}>שמור</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Activity Log Component
function ActivityLog() {
  const [activity, setActivity] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [whitelist, setWhitelist] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [activityData, statsData, chatsData] = await Promise.all([
        api.get('/bot-control/activity?limit=100'),
        api.get('/bot-control/activity/stats'),
        api.get('/bot-control/chats'),
      ]);
      setActivity(activityData);
      setStats(statsData);
      setWhitelist(chatsData.map(c => c.jid));
    } catch (err) {
      console.error('Failed to load activity:', err);
    }
    setLoading(false);
  };

  const quickAddToWhitelist = async (jid, isGroup) => {
    try {
      await api.post('/bot-control/chats', {
        jid: jid,
        display_name: jid,
        is_group: isGroup,
        enabled: true,
        ai_mode: 'on',
      });
      alert('נוסף לרשימה הלבנה!');
      loadData();
    } catch (err) {
      alert('שגיאה בהוספה - אולי כבר קיים');
    }
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString('he-IL');
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'responded':
        return <span className="badge badge-success">נענה</span>;
      case 'auto_reply':
        return <span className="badge badge-info">מענה אוטומטי</span>;
      case 'ignored':
      default:
        return <span className="badge badge-secondary">נדחה</span>;
    }
  };

  if (loading) return <div className="loading">טוען...</div>;

  return (
    <div>
      <div className="header">
        <h2>יומן פעילות</h2>
        <button className="btn btn-secondary" onClick={loadData}>רענן</button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <h3>סה"כ</h3>
          <div className="value">{stats.total || 0}</div>
        </div>
        <div className="stat-card">
          <h3>נענו</h3>
          <div className="value">{stats.responded || 0}</div>
        </div>
        <div className="stat-card">
          <h3>נדחו</h3>
          <div className="value">{stats.ignored || 0}</div>
        </div>
        <div className="stat-card">
          <h3>היום</h3>
          <div className="value">{stats.today_total || 0}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>היסטוריה אחרונה</h3>
        </div>
        <div className="card-body">
          {activity.length === 0 ? (
            <div className="empty-state">אין רישומי פעילות עדיין</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>זמן</th>
                  <th>מקור</th>
                  <th>JID</th>
                  <th>הודעה</th>
                  <th>סטטוס</th>
                  <th>סיבה</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {activity.map(a => (
                  <tr key={a.id}>
                    <td>{formatDate(a.timestamp)}</td>
                    <td>
                      <span className={`badge ${a.is_group ? 'badge-info' : 'badge-secondary'}`}>
                        {a.is_group ? 'קבוצה' : 'פרטי'}
                      </span>
                    </td>
                    <td className="jid-cell" title={a.jid}>{a.jid?.replace('@s.whatsapp.net', '').replace('@lid', '')}</td>
                    <td className="message-preview">{a.message}</td>
                    <td>{getStatusBadge(a.response_status)}</td>
                    <td className="reason-cell">{a.reason || '-'}</td>
                    <td>
                      {!whitelist.includes(a.jid) && (
                        <button
                          className="btn btn-primary btn-small"
                          onClick={() => quickAddToWhitelist(a.jid, a.is_group)}
                          title="הוסף לרשימה הלבנה"
                        >
                          ➕ הוסף
                        </button>
                      )}
                      {whitelist.includes(a.jid) && (
                        <span className="badge badge-success">ברשימה</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// Scheduler Component
function Scheduler() {
  const [scheduled, setScheduled] = useState([]);
  const [groups, setGroups] = useState([]);
  const [form, setForm] = useState({ jid: '', message: '', cronExpression: '', datetime: '' });
  const [mode, setMode] = useState('cron');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [scheduledData, groupsData] = await Promise.all([
        api.get('/scheduler'),
        api.get('/groups'),
      ]);
      setScheduled(scheduledData);
      setGroups(groupsData);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
    setLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (mode === 'cron') {
        await api.post('/scheduler', {
          jid: form.jid,
          message: form.message,
          cronExpression: form.cronExpression,
        });
      } else {
        await api.post('/scheduler/one-time', {
          jid: form.jid,
          message: form.message,
          datetime: form.datetime,
        });
      }
      setForm({ jid: '', message: '', cronExpression: '', datetime: '' });
      loadData();
      alert('ההודעה תוזמנה בהצלחה!');
    } catch (err) {
      alert('שגיאה בתזמון ההודעה');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('האם לבטל את התזמון?')) return;
    try {
      await api.delete(`/scheduler/${id}`);
      loadData();
    } catch (err) {
      alert('שגיאה בביטול התזמון');
    }
  };

  if (loading) return <div className="loading">טוען...</div>;

  return (
    <div>
      <div className="header">
        <h2>תזמון הודעות</h2>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>תזמון הודעה חדשה</h3>
        </div>
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>קבוצה / איש קשר</label>
              <select value={form.jid} onChange={e => setForm({...form, jid: e.target.value})} required>
                <option value="">בחר...</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>הודעה</label>
              <textarea
                value={form.message}
                onChange={e => setForm({...form, message: e.target.value})}
                placeholder="הקלד את ההודעה..."
                required
              />
            </div>
            <div className="form-group">
              <label>סוג תזמון</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    checked={mode === 'cron'}
                    onChange={() => setMode('cron')}
                  />
                  חוזר (Cron)
                </label>
                <label>
                  <input
                    type="radio"
                    checked={mode === 'datetime'}
                    onChange={() => setMode('datetime')}
                  />
                  חד פעמי
                </label>
              </div>
            </div>
            {mode === 'cron' ? (
              <div className="form-group">
                <label>ביטוי Cron (לדוגמה: "0 9 * * *" לכל יום ב-9 בבוקר)</label>
                <input
                  type="text"
                  placeholder="0 9 * * *"
                  value={form.cronExpression}
                  onChange={e => setForm({...form, cronExpression: e.target.value})}
                  required
                />
              </div>
            ) : (
              <div className="form-group">
                <label>תאריך ושעה</label>
                <input
                  type="datetime-local"
                  value={form.datetime}
                  onChange={e => setForm({...form, datetime: e.target.value})}
                  required
                />
              </div>
            )}
            <button type="submit" className="btn btn-primary">תזמן הודעה</button>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>הודעות מתוזמנות ({scheduled.length})</h3>
        </div>
        <div className="card-body">
          {scheduled.length === 0 ? (
            <div className="empty-state">אין הודעות מתוזמנות</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>יעד</th>
                  <th>הודעה</th>
                  <th>תזמון</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {scheduled.map(s => (
                  <tr key={s.id}>
                    <td>{groups.find(g => g.id === s.jid)?.name || s.jid}</td>
                    <td className="message-preview">{s.message}</td>
                    <td>{s.cronExpression} {s.oneTime && '(חד פעמי)'}</td>
                    <td>
                      <button className="btn btn-danger" onClick={() => handleDelete(s.id)}>
                        בטל
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// Groups Component
function Groups() {
  const [groups, setGroups] = useState([]);
  const [message, setMessage] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      const data = await api.get('/groups');
      setGroups(data);
    } catch (err) {
      console.error('Failed to load groups:', err);
    }
    setLoading(false);
  };

  const handleSend = async (groupId) => {
    if (!message.trim()) return;
    setSending(true);
    try {
      await api.post(`/groups/${encodeURIComponent(groupId)}/send`, { message });
      setMessage('');
      setSelectedGroup(null);
      alert('ההודעה נשלחה בהצלחה!');
    } catch (err) {
      alert('שגיאה בשליחת ההודעה');
    }
    setSending(false);
  };

  if (loading) return <div className="loading">טוען...</div>;

  return (
    <div>
      <div className="header">
        <h2>קבוצות ({groups.length})</h2>
      </div>
      <div className="card">
        <div className="card-body">
          {groups.length === 0 ? (
            <div className="empty-state">לא נמצאו קבוצות</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>שם הקבוצה</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.id}>
                    <td>{g.name}</td>
                    <td>
                      <button
                        className={`btn ${selectedGroup === g.id ? 'btn-secondary' : 'btn-primary'}`}
                        onClick={() => setSelectedGroup(selectedGroup === g.id ? null : g.id)}
                      >
                        {selectedGroup === g.id ? 'ביטול' : 'שליחה מהירה'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selectedGroup && (
        <div className="card">
          <div className="card-header">
            <h3>שליחה ל: {groups.find(g => g.id === selectedGroup)?.name}</h3>
          </div>
          <div className="card-body">
            <div className="form-group">
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="הקלד את ההודעה..."
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={() => handleSend(selectedGroup)}
              disabled={sending || !message.trim()}
            >
              {sending ? 'שולח...' : 'שלח'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Messages Component
function Messages() {
  const [messages, setMessages] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMessages();
  }, [page]);

  const loadMessages = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/messages?page=${page}&limit=50`);
      setMessages(data);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
    setLoading(false);
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString('he-IL');
  };

  return (
    <div>
      <div className="header">
        <h2>היסטוריית הודעות</h2>
      </div>
      <div className="card">
        <div className="card-body">
          {loading ? (
            <div className="loading">טוען...</div>
          ) : messages.length === 0 ? (
            <div className="empty-state">אין הודעות</div>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th>זמן</th>
                    <th>כיוון</th>
                    <th>יעד</th>
                    <th>הודעה</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map(m => (
                    <tr key={m.id}>
                      <td>{formatDate(m.timestamp)}</td>
                      <td>
                        <span className={`direction-badge ${m.direction}`}>
                          {m.direction === 'incoming' ? 'נכנס' : 'יוצא'}
                        </span>
                      </td>
                      <td>{m.jid}</td>
                      <td className="message-preview">{m.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pagination">
                <button
                  className="btn btn-secondary"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  הקודם
                </button>
                <span>עמוד {page}</span>
                <button
                  className="btn btn-secondary"
                  onClick={() => setPage(p => p + 1)}
                  disabled={messages.length < 50}
                >
                  הבא
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// AI Settings Component
function AISettings() {
  const [settings, setSettings] = useState({ systemPrompt: '' });
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [settingsData, conversationsData] = await Promise.all([
        api.get('/ai/settings'),
        api.get('/ai/history'),
      ]);
      setSettings(settingsData);
      setConversations(conversationsData);
    } catch (err) {
      console.error('Failed to load AI data:', err);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/ai/settings', settings);
      alert('ההגדרות נשמרו בהצלחה!');
    } catch (err) {
      alert('שגיאה בשמירת ההגדרות');
    }
    setSaving(false);
  };

  const handleClearAll = async () => {
    if (!confirm('האם למחוק את כל היסטוריית השיחות?')) return;
    try {
      await api.delete('/ai/history');
      setConversations([]);
      alert('ההיסטוריה נמחקה');
    } catch (err) {
      alert('שגיאה במחיקת ההיסטוריה');
    }
  };

  const handleClearOne = async (jid) => {
    try {
      await api.delete(`/ai/history/${encodeURIComponent(jid)}`);
      loadData();
    } catch (err) {
      alert('שגיאה במחיקת ההיסטוריה');
    }
  };

  if (loading) return <div className="loading">טוען...</div>;

  return (
    <div>
      <div className="header">
        <h2>הגדרות AI</h2>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>System Prompt</h3>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label>הוראות למודל ה-AI (גלובלי)</label>
            <textarea
              rows="5"
              value={settings.systemPrompt}
              onChange={e => setSettings({...settings, systemPrompt: e.target.value})}
              placeholder="הגדר את אופי הבוט..."
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'שומר...' : 'שמור הגדרות'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>היסטוריית שיחות ({conversations.length})</h3>
          {conversations.length > 0 && (
            <button className="btn btn-danger" onClick={handleClearAll}>
              מחק הכל
            </button>
          )}
        </div>
        <div className="card-body">
          {conversations.length === 0 ? (
            <div className="empty-state">אין שיחות פעילות</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>איש קשר / קבוצה</th>
                  <th>הודעות</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map(c => (
                  <tr key={c.jid}>
                    <td>{c.jid}</td>
                    <td>{c.messageCount} הודעות</td>
                    <td>
                      <button className="btn btn-danger" onClick={() => handleClearOne(c.jid)}>
                        מחק
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// Main App Component
function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard />;
      case 'control': return <BotControl />;
      case 'whitelist': return <Whitelist />;
      case 'activity': return <ActivityLog />;
      case 'scheduler': return <Scheduler />;
      case 'groups': return <Groups />;
      case 'messages': return <Messages />;
      case 'ai': return <AISettings />;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="app">
      <Sidebar currentPage={currentPage} setCurrentPage={setCurrentPage} />
      <div className="main">
        {renderPage()}
      </div>
    </div>
  );
}

// Render the app
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
