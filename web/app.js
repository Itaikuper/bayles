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
    { id: 'birthdays', label: 'ימי הולדת', icon: '🎂' },
    { id: 'groups', label: 'קבוצות', icon: '👥' },
    { id: 'messages', label: 'הודעות', icon: '💬' },
    { id: 'ai', label: 'הגדרות AI', icon: '🤖' },
    { id: 'personalities', label: 'אישיויות', icon: '🎭' },
    { id: 'tenants', label: 'עסקים', icon: '🏢' },
    { id: 'contacts', label: 'ספר טלפונים', icon: '📞' },
    { id: 'songs', label: 'שירים', icon: '🎸' },
    { id: 'calendar', label: 'יומן', icon: '📆' },
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
    // Load independently so one failure doesn't break the other
    try {
      const chatsData = await api.get('/bot-control/chats');
      setChats(chatsData);
    } catch (err) {
      console.error('Failed to load chats:', err);
    }
    try {
      const groupsData = await api.get('/bot-control/available-groups');
      setAvailableGroups(groupsData);
    } catch (err) {
      console.error('Failed to load available groups:', err);
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
        display_name: manualName.trim() || null,
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
        allowed_tools: editChat.allowed_tools_parsed,
        inject_user_memory: editChat.inject_user_memory ? true : false,
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
                  <th>JID</th>
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
                    <td style={{direction: 'ltr', fontSize: '0.85em', fontFamily: 'monospace'}}>{chat.jid}</td>
                    <td>
                      <span className={`badge ${chat.jid.endsWith('@newsletter') ? 'badge-warning' : chat.is_group ? 'badge-info' : 'badge-secondary'}`}>
                        {chat.jid.endsWith('@newsletter') ? '📢 ערוץ' : chat.is_group ? 'קבוצה' : 'פרטי'}
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
                      <button className="btn btn-small btn-primary" onClick={() => {
                        const parsed = chat.allowed_tools ? JSON.parse(chat.allowed_tools) : null;
                        setEditChat({...chat, allowed_tools_parsed: parsed, inject_user_memory: !!chat.inject_user_memory});
                      }}>
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
              <hr style={{margin: '12px 0', borderColor: '#333'}} />
              <h4 style={{margin: '0 0 8px', textAlign: 'right'}}>פרטיות וכלים</h4>
              <label style={{display: 'block', textAlign: 'right', margin: '8px 0', cursor: 'pointer'}}>
                <input
                  type="checkbox"
                  checked={editChat.inject_user_memory}
                  onChange={e => setEditChat({...editChat, inject_user_memory: e.target.checked})}
                  style={{marginLeft: '6px'}}
                />
                הזרקת זיכרון אישי (עובדות שהבוט למד על המשתמש)
              </label>
              <label style={{display: 'block', textAlign: 'right', margin: '8px 0', cursor: 'pointer'}}>
                <input
                  type="checkbox"
                  checked={editChat.allowed_tools_parsed === null}
                  onChange={e => setEditChat({
                    ...editChat,
                    allowed_tools_parsed: e.target.checked ? null : ['search_hoshaya_directory']
                  })}
                  style={{marginLeft: '6px'}}
                />
                כל הכלים מאופשרים
              </label>
              {editChat.allowed_tools_parsed !== null && (
                <div style={{paddingRight: '24px', borderRight: '2px solid #ddd', marginRight: '8px'}}>
                  {[
                    {name: 'search_song', label: 'חיפוש שירים'},
                    {name: 'search_contact', label: 'אנשי קשר'},
                    {name: 'search_hoshaya_directory', label: 'ספר טלפונים הושעיה'},
                    {name: 'create_schedule', label: 'תזמון הודעות'},
                    {name: 'send_message', label: 'שליחת הודעות'},
                    {name: 'list_calendar_events', label: 'יומן (Google Calendar)'},
                    {name: 'manage_chore_rotation', label: 'תורנויות'},
                  ].map(tool => (
                    <label key={tool.name} style={{display: 'block', textAlign: 'right', margin: '6px 0', cursor: 'pointer'}}>
                      <input
                        type="checkbox"
                        checked={(editChat.allowed_tools_parsed || []).includes(tool.name)}
                        onChange={e => {
                          const current = editChat.allowed_tools_parsed || [];
                          const updated = e.target.checked
                            ? [...current, tool.name]
                            : current.filter(t => t !== tool.name);
                          setEditChat({...editChat, allowed_tools_parsed: updated});
                        }}
                        style={{marginLeft: '6px'}}
                      />
                      {tool.label}
                    </label>
                  ))}
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
        display_name: null,
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
const DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function cronToHumanReadable(cronExpr, oneTime) {
  if (oneTime) return '(חד פעמי)';
  try {
    const parts = cronExpr.split(' ');
    if (parts.length < 5) return cronExpr;
    const minute = parts[0].padStart(2, '0');
    const hour = parts[1].padStart(2, '0');
    const daysPart = parts[4];
    const timeStr = `${hour}:${minute}`;
    if (daysPart === '*') return `${timeStr} כל יום`;
    const dayNums = daysPart.split(',').map(Number);
    const dayNames = dayNums.map(d => DAY_NAMES[d] || d).join(' ');
    return `${timeStr} בימים ${dayNames}`;
  } catch {
    return cronExpr;
  }
}

function Scheduler() {
  const [scheduled, setScheduled] = useState([]);
  const [chats, setChats] = useState([]);
  const [form, setForm] = useState({ jid: '', message: '', time: '09:00', days: [...ALL_DAYS], datetime: '', useAi: false });
  const [mode, setMode] = useState('recurring');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    // Load independently so one failure doesn't break the other
    try {
      const scheduledData = await api.get('/scheduler');
      setScheduled(scheduledData);
    } catch (err) {
      console.error('Failed to load scheduled messages:', err);
    }
    try {
      const chatsData = await api.get('/bot-control/chats');
      setChats(chatsData.filter(c => c.enabled));
    } catch (err) {
      console.error('Failed to load chats:', err);
    }
    setLoading(false);
  };

  const toggleDay = (day) => {
    const newDays = form.days.includes(day)
      ? form.days.filter(d => d !== day)
      : [...form.days, day].sort();
    setForm({...form, days: newDays});
  };

  const toggleAllDays = () => {
    setForm({...form, days: form.days.length === 7 ? [] : [...ALL_DAYS]});
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (mode === 'recurring') {
        if (form.days.length === 0) {
          alert('יש לבחור לפחות יום אחד');
          return;
        }
        await api.post('/scheduler', {
          jid: form.jid,
          message: form.message,
          time: form.time,
          days: form.days,
          useAi: form.useAi,
        });
      } else {
        await api.post('/scheduler/one-time', {
          jid: form.jid,
          message: form.message,
          datetime: form.datetime,
          useAi: form.useAi,
        });
      }
      setForm({ jid: '', message: '', time: '09:00', days: [...ALL_DAYS], datetime: '', useAi: false });
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
                {chats.map(c => (
                  <option key={c.jid} value={c.jid}>{c.jid.endsWith('@newsletter') ? '📢 ' : c.jid.endsWith('@g.us') ? '👥 ' : '👤 '}{c.display_name || c.jid}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>{form.useAi ? 'פרומפט AI' : 'הודעה'}</label>
              <textarea
                value={form.message}
                onChange={e => setForm({...form, message: e.target.value})}
                placeholder={form.useAi
                  ? 'הקלד פרומפט ל-AI, לדוגמה: בוקר טוב, מזג האוויר היום הוא ___ ותן המלצת לבוש'
                  : 'הקלד את ההודעה...'}
                required
              />
            </div>
            <div className="form-group">
              <label style={{display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer'}}>
                <input
                  type="checkbox"
                  checked={form.useAi}
                  onChange={e => setForm({...form, useAi: e.target.checked})}
                />
                עיבוד AI - ההודעה תשמש כפרומפט ל-Gemini AI
              </label>
              {form.useAi && (
                <div style={{marginTop: '8px', padding: '10px', background: '#e8f5e9', borderRadius: '6px', fontSize: '13px', lineHeight: '1.6'}}>
                  <strong>מצב AI פעיל:</strong> הטקסט שלמעלה ישמש כפרומפט. Gemini ייצור תשובה חדשה בכל פעם שההודעה תישלח.
                  {' '}יש לו גישה לחיפוש Google למידע בזמן אמת (מזג אוויר, חדשות וכו׳).
                </div>
              )}
            </div>
            <div className="form-group">
              <label>סוג תזמון</label>
              <div className="radio-group">
                <label>
                  <input
                    type="radio"
                    checked={mode === 'recurring'}
                    onChange={() => setMode('recurring')}
                  />
                  חוזר
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
            {mode === 'recurring' ? (
              <>
                <div className="form-group">
                  <label>שעה</label>
                  <input
                    type="time"
                    value={form.time}
                    onChange={e => setForm({...form, time: e.target.value})}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>ימים</label>
                  <div style={{display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center'}}>
                    <button
                      type="button"
                      onClick={toggleAllDays}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #ccc',
                        background: form.days.length === 7 ? '#4caf50' : '#f5f5f5',
                        color: form.days.length === 7 ? '#fff' : '#333',
                        cursor: 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      כל יום
                    </button>
                    {DAY_NAMES.map((name, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleDay(i)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: '1px solid #ccc',
                          background: form.days.includes(i) ? '#2196f3' : '#f5f5f5',
                          color: form.days.includes(i) ? '#fff' : '#333',
                          cursor: 'pointer',
                          minWidth: '36px',
                          fontSize: '13px',
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              </>
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
                  <th>הודעה / פרומפט</th>
                  <th>סוג</th>
                  <th>תזמון</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {scheduled.map(s => (
                  <tr key={s.id}>
                    <td>{s.jid.endsWith('@newsletter') ? '📢 ' : s.jid.endsWith('@g.us') ? '👥 ' : '👤 '}{chats.find(c => c.jid === s.jid)?.display_name || s.jid}</td>
                    <td className="message-preview">{s.message}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        background: s.useAi ? '#e8f5e9' : '#f5f5f5',
                        color: s.useAi ? '#2e7d32' : '#666',
                        fontWeight: 'bold',
                      }}>
                        {s.useAi ? 'AI' : 'רגיל'}
                      </span>
                    </td>
                    <td>{cronToHumanReadable(s.cronExpression, s.oneTime)}</td>
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

// Personalities Component - manages custom_prompt and knowledge base per chat
function Personalities() {
  const [chats, setChats] = useState([]);
  const [selectedJid, setSelectedJid] = useState('');
  const [selectedChat, setSelectedChat] = useState(null);
  const [knowledge, setKnowledge] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form states
  const [customPrompt, setCustomPrompt] = useState('');
  const [newItem, setNewItem] = useState({ title: '', content: '', category: 'general' });
  const [editItem, setEditItem] = useState(null);

  useEffect(() => {
    loadChats();
  }, []);

  useEffect(() => {
    if (selectedJid) {
      loadChatDetails(selectedJid);
      loadKnowledge(selectedJid);
    }
  }, [selectedJid]);

  const loadChats = async () => {
    try {
      const data = await api.get('/bot-control/chats');
      const enabled = data.filter(c => c.enabled && c.ai_mode === 'on');
      setChats(enabled);
      if (enabled.length > 0 && !selectedJid) {
        setSelectedJid(enabled[0].jid);
      }
    } catch (err) {
      console.error('Failed to load chats:', err);
    }
    setLoading(false);
  };

  const loadChatDetails = async (jid) => {
    try {
      const data = await api.get('/bot-control/chats');
      const chat = data.find(c => c.jid === jid);
      setSelectedChat(chat);
      setCustomPrompt(chat?.custom_prompt || '');
    } catch (err) {
      console.error('Failed to load chat details:', err);
    }
  };

  const loadKnowledge = async (jid) => {
    try {
      const data = await api.get(`/knowledge/${encodeURIComponent(jid)}`);
      setKnowledge(data);
    } catch (err) {
      console.error('Failed to load knowledge:', err);
      setKnowledge([]);
    }
  };

  const savePrompt = async () => {
    setSaving(true);
    try {
      await api.put(`/bot-control/chats/${encodeURIComponent(selectedJid)}`, {
        custom_prompt: customPrompt || null,
      });
      alert('הפרומפט נשמר בהצלחה!');
    } catch (err) {
      alert('שגיאה בשמירה');
    }
    setSaving(false);
  };

  const addKnowledgeItem = async (e) => {
    e.preventDefault();
    if (!newItem.title.trim() || !newItem.content.trim()) return;

    try {
      await api.post('/knowledge', {
        jid: selectedJid,
        ...newItem,
      });
      setNewItem({ title: '', content: '', category: 'general' });
      loadKnowledge(selectedJid);
    } catch (err) {
      alert('שגיאה בהוספת פריט');
    }
  };

  const updateKnowledgeItem = async () => {
    if (!editItem) return;
    try {
      await api.put(`/knowledge/${editItem.id}`, {
        title: editItem.title,
        content: editItem.content,
        category: editItem.category,
      });
      setEditItem(null);
      loadKnowledge(selectedJid);
    } catch (err) {
      alert('שגיאה בעדכון');
    }
  };

  const deleteKnowledgeItem = async (id) => {
    if (!confirm('האם למחוק פריט זה?')) return;
    try {
      await api.delete(`/knowledge/${id}`);
      loadKnowledge(selectedJid);
    } catch (err) {
      alert('שגיאה במחיקה');
    }
  };

  if (loading) return <div className="loading">טוען...</div>;

  return (
    <div>
      <div className="header">
        <h2>אישיויות ומאגר ידע</h2>
      </div>

      {/* Chat Selector */}
      <div className="card">
        <div className="card-header">
          <h3>בחר צ׳אט</h3>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label>הגדרות האישיות חלות על הצ׳אט שנבחר</label>
            <select value={selectedJid} onChange={e => setSelectedJid(e.target.value)}>
              {chats.map(c => (
                <option key={c.jid} value={c.jid}>
                  {c.display_name || c.jid} {c.is_group ? '(קבוצה)' : ''}
                </option>
              ))}
            </select>
          </div>
          {chats.length === 0 && (
            <div className="info-box">
              אין צ׳אטים עם AI פעיל. הפעל AI ברשימה הלבנה כדי להגדיר אישיות.
            </div>
          )}
        </div>
      </div>

      {selectedJid && (
        <>
          {/* Custom Prompt Section */}
          <div className="card">
            <div className="card-header">
              <h3>פרומפט מותאם (אישיות)</h3>
            </div>
            <div className="card-body">
              <div className="form-group">
                <label>הוראות ייחודיות לצ׳אט זה (מחליף את הפרומפט הגלובלי)</label>
                <textarea
                  rows="5"
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  placeholder="השאר ריק לשימוש בפרומפט הגלובלי..."
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={savePrompt}
                disabled={saving}
              >
                {saving ? 'שומר...' : 'שמור פרומפט'}
              </button>
            </div>
          </div>

          {/* Knowledge Base Section */}
          <div className="card">
            <div className="card-header">
              <h3>מאגר ידע ({knowledge.length} פריטים)</h3>
            </div>
            <div className="card-body">
              <div className="info-box" style={{marginBottom: '16px'}}>
                פריטי הידע מוזרקים אוטומטית לפרומפט של ה-AI. השתמש בזה להוסיף מידע קבוע כמו שעות פעילות, מחירון, FAQ וכו׳.
              </div>

              {/* Add new item form */}
              <div style={{marginBottom: '20px', padding: '16px', background: '#f5f5f5', borderRadius: '8px'}}>
                <h4 style={{marginTop: 0}}>הוסף פריט חדש</h4>
                <div className="form-group">
                  <label>כותרת</label>
                  <input
                    type="text"
                    value={newItem.title}
                    onChange={e => setNewItem({...newItem, title: e.target.value})}
                    placeholder="לדוגמה: שעות פעילות"
                  />
                </div>
                <div className="form-group">
                  <label>תוכן</label>
                  <textarea
                    value={newItem.content}
                    onChange={e => setNewItem({...newItem, content: e.target.value})}
                    placeholder="המידע עצמו..."
                  />
                </div>
                <div className="form-group">
                  <label>קטגוריה (אופציונלי)</label>
                  <input
                    type="text"
                    value={newItem.category}
                    onChange={e => setNewItem({...newItem, category: e.target.value})}
                    placeholder="general"
                  />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={addKnowledgeItem}
                  disabled={!newItem.title.trim() || !newItem.content.trim()}
                >
                  הוסף פריט
                </button>
              </div>

              {/* Knowledge items list */}
              {knowledge.length === 0 ? (
                <div className="empty-state">אין פריטי ידע. הוסף מידע שה-AI צריך לדעת.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>כותרת</th>
                      <th>קטגוריה</th>
                      <th>תוכן</th>
                      <th>פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {knowledge.map(item => (
                      <tr key={item.id}>
                        <td>{item.title}</td>
                        <td><span className="badge badge-info">{item.category}</span></td>
                        <td className="message-preview">{item.content.substring(0, 100)}{item.content.length > 100 ? '...' : ''}</td>
                        <td>
                          <button
                            className="btn btn-small btn-primary"
                            onClick={() => setEditItem({...item})}
                            style={{marginLeft: '4px'}}
                          >
                            ערוך
                          </button>
                          <button
                            className="btn btn-small btn-danger"
                            onClick={() => deleteKnowledgeItem(item.id)}
                          >
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
        </>
      )}

      {/* Edit Modal */}
      {editItem && (
        <div className="modal-overlay" onClick={() => setEditItem(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>עריכת פריט ידע</h3>
              <button className="modal-close" onClick={() => setEditItem(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>כותרת</label>
                <input
                  type="text"
                  value={editItem.title}
                  onChange={e => setEditItem({...editItem, title: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>תוכן</label>
                <textarea
                  rows="5"
                  value={editItem.content}
                  onChange={e => setEditItem({...editItem, content: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>קטגוריה</label>
                <input
                  type="text"
                  value={editItem.category}
                  onChange={e => setEditItem({...editItem, category: e.target.value})}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditItem(null)}>ביטול</button>
              <button className="btn btn-primary" onClick={updateKnowledgeItem}>שמור</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Main App Component
// Birthdays Component
const MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function Birthdays() {
  const [chats, setChats] = useState([]);
  const [selectedJid, setSelectedJid] = useState('');
  const [birthdays, setBirthdays] = useState([]);
  const [listText, setListText] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  // Manual add form
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ person_name: '', birth_day: '', birth_month: '' });

  useEffect(() => {
    loadChats();
  }, []);

  useEffect(() => {
    if (selectedJid) loadBirthdays(selectedJid);
  }, [selectedJid]);

  const loadChats = async () => {
    try {
      const data = await api.get('/bot-control/chats');
      const enabled = data.filter(c => c.enabled);
      setChats(enabled);
      if (enabled.length > 0) setSelectedJid(enabled[0].jid);
    } catch (err) {
      console.error('Failed to load chats:', err);
    }
    setLoading(false);
  };

  const loadBirthdays = async (jid) => {
    try {
      const data = await api.get(`/birthdays/by-jid/${encodeURIComponent(jid)}`);
      setBirthdays(data);
    } catch (err) {
      console.error('Failed to load birthdays:', err);
    }
  };

  const handleAddList = async (e) => {
    e.preventDefault();
    if (!listText.trim() || !selectedJid) return;

    setAdding(true);
    try {
      const result = await api.post('/birthdays/parse', { jid: selectedJid, text: listText });
      alert(`נוספו ${result.count} ימי הולדת!`);
      setListText('');
      loadBirthdays(selectedJid);
    } catch (err) {
      alert('שגיאה בהוספת ימי הולדת. בדוק את הפורמט.');
    }
    setAdding(false);
  };

  const handleAddManual = async (e) => {
    e.preventDefault();
    if (!manualForm.person_name || !manualForm.birth_day || !manualForm.birth_month) return;

    try {
      await api.post('/birthdays', {
        jid: selectedJid,
        person_name: manualForm.person_name,
        birth_day: parseInt(manualForm.birth_day),
        birth_month: parseInt(manualForm.birth_month),
      });
      setManualForm({ person_name: '', birth_day: '', birth_month: '' });
      setShowManual(false);
      loadBirthdays(selectedJid);
    } catch (err) {
      alert('שגיאה בהוספת יום הולדת');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('למחוק יום הולדת זה?')) return;
    try {
      await api.delete(`/birthdays/${id}`);
      loadBirthdays(selectedJid);
    } catch (err) {
      alert('שגיאה במחיקה');
    }
  };

  if (loading) return <div className="loading">טוען...</div>;

  return (
    <div>
      <div className="header">
        <h2>ימי הולדת</h2>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>בחר צ׳אט</h3>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label>הברכות יישלחו לצ׳אט שנבחר</label>
            <select value={selectedJid} onChange={e => setSelectedJid(e.target.value)}>
              {chats.map(c => (
                <option key={c.jid} value={c.jid}>{c.display_name || c.jid}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3>הוספת ימי הולדת מרשימה (AI)</h3>
        </div>
        <div className="card-body">
          <form onSubmit={handleAddList}>
            <div className="form-group">
              <label>כתוב רשימה חופשית - הבוט יפענח אותה</label>
              <textarea
                value={listText}
                onChange={e => setListText(e.target.value)}
                placeholder="דוגמה: איתי 5 פברואר יהודה 25 מרץ שרה 15/12"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={adding}>
              {adding ? 'מעבד...' : 'הוסף רשימה'}
            </button>
          </form>
          <div style={{marginTop: '8px', padding: '10px', background: '#e8f5e9', borderRadius: '6px', fontSize: '13px', lineHeight: '1.6'}}>
            הבוט משתמש ב-AI כדי להבין את הרשימה. ברכות אוטומטיות נשלחות בכל יום הולדת ב-08:00 בבוקר.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <h3>ימי הולדת שמורים ({birthdays.length})</h3>
          <button className="btn btn-primary" onClick={() => setShowManual(!showManual)}>
            {showManual ? 'ביטול' : 'הוספה ידנית'}
          </button>
        </div>
        <div className="card-body">
          {showManual && (
            <form onSubmit={handleAddManual} style={{marginBottom: '16px', padding: '12px', background: '#f5f5f5', borderRadius: '6px'}}>
              <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end'}}>
                <div className="form-group" style={{margin: 0, flex: 1, minWidth: '120px'}}>
                  <label>שם</label>
                  <input
                    type="text"
                    value={manualForm.person_name}
                    onChange={e => setManualForm({...manualForm, person_name: e.target.value})}
                    placeholder="שם"
                    required
                  />
                </div>
                <div className="form-group" style={{margin: 0, width: '80px'}}>
                  <label>יום</label>
                  <input
                    type="number"
                    min="1" max="31"
                    value={manualForm.birth_day}
                    onChange={e => setManualForm({...manualForm, birth_day: e.target.value})}
                    required
                  />
                </div>
                <div className="form-group" style={{margin: 0, width: '120px'}}>
                  <label>חודש</label>
                  <select
                    value={manualForm.birth_month}
                    onChange={e => setManualForm({...manualForm, birth_month: e.target.value})}
                    required
                  >
                    <option value="">בחר...</option>
                    {MONTH_NAMES.map((name, i) => (
                      <option key={i + 1} value={i + 1}>{name}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary">הוסף</button>
              </div>
            </form>
          )}

          {birthdays.length === 0 ? (
            <div className="empty-state">אין ימי הולדת שמורים</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>שם</th>
                  <th>תאריך</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {birthdays.map(b => (
                  <tr key={b.id}>
                    <td>{b.person_name}</td>
                    <td>{b.birth_day} {MONTH_NAMES[b.birth_month - 1]}</td>
                    <td>
                      <button className="btn btn-danger" onClick={() => handleDelete(b.id)}>
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

// Tenants Component - Multi-tenant management
function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: '', system_prompt: '' });
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [qrLoading, setQrLoading] = useState({});
  const [qrImages, setQrImages] = useState({});

  useEffect(() => {
    loadTenants();
    const interval = setInterval(loadTenants, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadTenants = async () => {
    try {
      const data = await api.get('/tenants');
      setTenants(data);
    } catch (err) {
      console.error('Failed to load tenants:', err);
    }
    setLoading(false);
  };

  const createTenant = async () => {
    if (!newTenant.name.trim()) {
      alert('יש להזין שם לעסק');
      return;
    }
    try {
      await api.post('/tenants', newTenant);
      setNewTenant({ name: '', system_prompt: '' });
      setShowAddModal(false);
      loadTenants();
    } catch (err) {
      alert('שגיאה ביצירת העסק');
    }
  };

  const deleteTenant = async (id) => {
    if (!confirm('האם למחוק את העסק הזה? כל הנתונים יימחקו!')) return;
    try {
      await api.delete(`/tenants/${id}`);
      loadTenants();
    } catch (err) {
      alert('שגיאה במחיקה: ' + (err.message || ''));
    }
  };

  const connectTenant = async (id) => {
    setQrLoading(prev => ({ ...prev, [id]: true }));
    try {
      await api.post(`/tenants/${id}/connect`);
      // Wait a bit and fetch QR
      setTimeout(() => fetchQR(id), 2000);
    } catch (err) {
      alert('שגיאה בהתחברות');
      setQrLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  const disconnectTenant = async (id) => {
    try {
      await api.post(`/tenants/${id}/disconnect`);
      setQrImages(prev => ({ ...prev, [id]: null }));
      loadTenants();
    } catch (err) {
      alert('שגיאה בניתוק');
    }
  };

  const fetchQR = async (id) => {
    try {
      const res = await fetch(`/api/tenants/${id}/qr`);
      if (res.ok && res.headers.get('content-type')?.includes('image')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setQrImages(prev => ({ ...prev, [id]: url }));
      } else {
        const data = await res.json();
        if (data.status === 'connected') {
          loadTenants();
        }
      }
    } catch (err) {
      console.error('Failed to fetch QR:', err);
    }
    setQrLoading(prev => ({ ...prev, [id]: false }));
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'connected':
        return <span className="badge badge-success">מחובר</span>;
      case 'connecting':
        return <span className="badge badge-warning">מתחבר...</span>;
      case 'disconnected':
        return <span className="badge badge-secondary">מנותק</span>;
      default:
        return <span className="badge badge-secondary">{status}</span>;
    }
  };

  if (loading) return <div className="loading">טוען...</div>;

  return (
    <div>
      <div className="header">
        <h2>ניהול עסקים</h2>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          הוסף עסק חדש
        </button>
      </div>

      <div className="info-box" style={{ marginBottom: '20px' }}>
        כאן תוכל לנהל מספר עסקים. כל עסק מקבל מספר WhatsApp משלו, QR סריקה נפרדת, ומאגר ידע ייחודי.
      </div>

      <div className="card">
        <div className="card-header">
          <h3>עסקים ({tenants.length})</h3>
        </div>
        <div className="card-body">
          {tenants.length === 0 ? (
            <div className="empty-state">אין עסקים. צור עסק חדש כדי להתחיל.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>שם</th>
                  <th>מספר טלפון</th>
                  <th>סטטוס</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(tenant => (
                  <tr key={tenant.id}>
                    <td>
                      <strong>{tenant.name}</strong>
                      {tenant.id === 'default' && <span className="badge badge-info" style={{ marginRight: '8px' }}>ברירת מחדל</span>}
                    </td>
                    <td>{tenant.phone || '-'}</td>
                    <td>{getStatusBadge(tenant.connectionStatus || tenant.status)}</td>
                    <td>
                      {tenant.connectionStatus === 'connected' ? (
                        <button
                          className="btn btn-small btn-danger"
                          onClick={() => disconnectTenant(tenant.id)}
                        >
                          נתק
                        </button>
                      ) : (
                        <button
                          className="btn btn-small btn-primary"
                          onClick={() => connectTenant(tenant.id)}
                          disabled={qrLoading[tenant.id]}
                        >
                          {qrLoading[tenant.id] ? 'מתחבר...' : 'חבר'}
                        </button>
                      )}
                      <button
                        className="btn btn-small btn-secondary"
                        onClick={() => setSelectedTenant(tenant)}
                        style={{ marginRight: '4px' }}
                      >
                        הגדרות
                      </button>
                      {tenant.id !== 'default' && (
                        <button
                          className="btn btn-small btn-danger"
                          onClick={() => deleteTenant(tenant.id)}
                          style={{ marginRight: '4px' }}
                        >
                          מחק
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* QR Code Display */}
      {Object.entries(qrImages).map(([id, url]) => url && (
        <div key={id} className="card">
          <div className="card-header">
            <h3>סרוק QR עבור: {tenants.find(t => t.id === id)?.name}</h3>
            <button className="btn btn-small btn-secondary" onClick={() => setQrImages(prev => ({ ...prev, [id]: null }))}>
              סגור
            </button>
          </div>
          <div className="card-body" style={{ textAlign: 'center' }}>
            <img src={url} alt="QR Code" style={{ maxWidth: '300px' }} />
            <p style={{ marginTop: '16px', color: '#666' }}>
              סרוק את הקוד באפליקציית WhatsApp (מכשירים מקושרים)
            </p>
            <button className="btn btn-secondary" onClick={() => fetchQR(id)}>
              רענן QR
            </button>
          </div>
        </div>
      ))}

      {/* Add Tenant Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>הוסף עסק חדש</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>שם העסק</label>
                <input
                  type="text"
                  value={newTenant.name}
                  onChange={e => setNewTenant({ ...newTenant, name: e.target.value })}
                  placeholder="לדוגמה: פיצה רומא"
                />
              </div>
              <div className="form-group">
                <label>System Prompt (אופציונלי)</label>
                <textarea
                  value={newTenant.system_prompt}
                  onChange={e => setNewTenant({ ...newTenant, system_prompt: e.target.value })}
                  placeholder="הוראות ייחודיות לבוט של העסק הזה..."
                  rows="4"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>ביטול</button>
              <button className="btn btn-primary" onClick={createTenant}>צור עסק</button>
            </div>
          </div>
        </div>
      )}

      {/* Tenant Settings Modal */}
      {selectedTenant && (
        <div className="modal-overlay" onClick={() => setSelectedTenant(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>הגדרות: {selectedTenant.name}</h3>
              <button className="modal-close" onClick={() => setSelectedTenant(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="settings-row">
                <span>מזהה:</span>
                <code style={{ background: '#f5f5f5', padding: '2px 8px', borderRadius: '4px' }}>{selectedTenant.id}</code>
              </div>
              <div className="settings-row">
                <span>מספר טלפון:</span>
                <span>{selectedTenant.phone || 'לא מחובר'}</span>
              </div>
              <div className="settings-row">
                <span>סטטוס:</span>
                {getStatusBadge(selectedTenant.connectionStatus || selectedTenant.status)}
              </div>
              <div className="settings-row">
                <span>נוצר:</span>
                <span>{new Date(selectedTenant.created_at).toLocaleString('he-IL')}</span>
              </div>
              {selectedTenant.system_prompt && (
                <div style={{ marginTop: '16px' }}>
                  <strong>System Prompt:</strong>
                  <div style={{ marginTop: '8px', padding: '12px', background: '#f5f5f5', borderRadius: '6px', whiteSpace: 'pre-wrap' }}>
                    {selectedTenant.system_prompt}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSelectedTenant(null)}>סגור</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', notes: '', category: 'general' });
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadContacts();
  }, []);

  const loadContacts = async () => {
    try {
      const data = await api.get('/contacts');
      setContacts(data);
    } catch (err) {
      console.error('Failed to load contacts:', err);
    }
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!form.name || !form.phone) return;
    try {
      if (editingContact) {
        await api.put(`/contacts/${editingContact.id}`, form);
      } else {
        await api.post('/contacts', form);
      }
      setForm({ name: '', phone: '', notes: '', category: 'general' });
      setShowForm(false);
      setEditingContact(null);
      loadContacts();
    } catch (err) {
      console.error('Failed to save contact:', err);
    }
  };

  const handleEdit = (contact) => {
    setForm({ name: contact.name, phone: contact.phone, notes: contact.notes || '', category: contact.category || 'general' });
    setEditingContact(contact);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('למחוק איש קשר?')) return;
    try {
      await api.delete(`/contacts/${id}`);
      loadContacts();
    } catch (err) {
      console.error('Failed to delete contact:', err);
    }
  };

  const filteredContacts = searchQuery
    ? contacts.filter(c => c.name.includes(searchQuery) || c.phone.includes(searchQuery))
    : contacts;

  if (loading) return <div className="loading">טוען...</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h2>📞 ספר טלפונים</h2>
        <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditingContact(null); setForm({ name: '', phone: '', notes: '', category: 'general' }); }}>
          + הוסף איש קשר
        </button>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="חיפוש לפי שם או טלפון..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input"
          style={{ maxWidth: '400px' }}
        />
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>שם</th>
              <th>טלפון</th>
              <th>הערות</th>
              <th>קטגוריה</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filteredContacts.map(contact => (
              <tr key={contact.id}>
                <td><strong>{contact.name}</strong></td>
                <td>{contact.phone}</td>
                <td>{contact.notes || '-'}</td>
                <td>{contact.category}</td>
                <td>
                  <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(contact)}>ערוך</button>
                  {' '}
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(contact.id)}>מחק</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredContacts.length === 0 && <p style={{ textAlign: 'center', padding: '20px', color: '#888' }}>אין אנשי קשר</p>}
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editingContact ? 'עריכת איש קשר' : 'הוספת איש קשר'}</h3>
            <div className="form-group">
              <label>שם</label>
              <input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="שם מלא" />
            </div>
            <div className="form-group">
              <label>טלפון</label>
              <input className="input" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="050-1234567" />
            </div>
            <div className="form-group">
              <label>הערות</label>
              <input className="input" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="הערות (אופציונלי)" />
            </div>
            <div className="form-group">
              <label>קטגוריה</label>
              <input className="input" value={form.category} onChange={e => setForm({...form, category: e.target.value})} placeholder="general" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={handleSubmit}>{editingContact ? 'עדכן' : 'הוסף'}</button>
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>ביטול</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Songs() {
  const [songs, setSongs] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const data = await api.get('/songs/stats');
      setTotalCount(data.count);
    } catch (err) {
      console.error('Failed to load song stats:', err);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const data = await api.get(`/songs/search?q=${encodeURIComponent(searchQuery)}&limit=50`);
      setSongs(data);
    } catch (err) {
      console.error('Failed to search songs:', err);
    }
    setLoading(false);
  };

  return (
    <div className="page">
      <div className="page-header">
        <h2>🎸 שירים ואקורדים</h2>
        <span style={{ color: '#888' }}>{totalCount} שירים במאגר</span>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="חיפוש שיר או זמר..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          className="input"
          style={{ maxWidth: '400px' }}
        />
        <button className="btn btn-primary" onClick={handleSearch}>חפש</button>
      </div>

      {loading && <div className="loading">מחפש...</div>}

      {!loading && songs.length > 0 && (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>שיר</th>
                <th>זמר</th>
                <th>Capo</th>
                <th>לינק</th>
              </tr>
            </thead>
            <tbody>
              {songs.map(song => (
                <tr key={song.id}>
                  <td><strong>{song.title}</strong></td>
                  <td>{song.artist}</td>
                  <td>{song.capo || '-'}</td>
                  <td><a href={song.url} target="_blank" rel="noopener noreferrer">פתח באתר</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && songs.length === 0 && searchQuery && (
        <p style={{ textAlign: 'center', padding: '20px', color: '#888' }}>לא נמצאו שירים</p>
      )}
    </div>
  );
}

function Calendar() {
  const [links, setLinks] = useState([]);
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLink, setNewLink] = useState({ jid: '', calendar_id: '', display_name: '' });
  const [editLink, setEditLink] = useState(null);

  // Event preview
  const [previewJid, setPreviewJid] = useState('');
  const [previewDate, setPreviewDate] = useState(new Date().toISOString().split('T')[0]);
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [linksData, chatsData] = await Promise.all([
        api.get('/calendar/links'),
        api.get('/bot-control/chats'),
      ]);
      setLinks(linksData);
      setChats(chatsData);
    } catch (err) {
      console.error('Failed to load calendar data:', err);
    }
    setLoading(false);
  };

  const addLink = async () => {
    if (!newLink.jid || !newLink.calendar_id) {
      alert('יש לבחור צ׳אט ולהזין Calendar ID');
      return;
    }
    try {
      await api.post('/calendar/links', newLink);
      setNewLink({ jid: '', calendar_id: '', display_name: '' });
      setShowAddModal(false);
      loadData();
    } catch (err) {
      alert('שגיאה בהוספת קישור - אולי כבר קיים');
    }
  };

  const updateLink = async () => {
    if (!editLink) return;
    try {
      await api.put(`/calendar/links/${editLink.id}`, {
        display_name: editLink.display_name,
        is_default: editLink.is_default,
        daily_summary: editLink.daily_summary,
        reminder_minutes: editLink.reminder_minutes,
      });
      setEditLink(null);
      loadData();
    } catch (err) {
      alert('שגיאה בעדכון');
    }
  };

  const deleteLink = async (id) => {
    if (!confirm('האם להסיר את הקישור ליומן?')) return;
    try {
      await api.delete(`/calendar/links/${id}`);
      loadData();
    } catch (err) {
      alert('שגיאה במחיקה');
    }
  };

  const loadEvents = async () => {
    if (!previewJid) return;
    setLoadingEvents(true);
    try {
      const data = await api.get(`/calendar/events?jid=${encodeURIComponent(previewJid)}&date=${previewDate}`);
      setEvents(data);
    } catch (err) {
      console.error('Failed to load events:', err);
      setEvents([]);
    }
    setLoadingEvents(false);
  };

  const triggerDailySummary = async () => {
    try {
      await api.post('/calendar/daily-summary', {});
      alert('סיכום יומי נשלח!');
    } catch (err) {
      alert('שגיאה בשליחת סיכום');
    }
  };

  const formatEventTime = (event) => {
    if (event.start?.date) return 'כל היום';
    if (event.start?.dateTime) {
      const start = new Date(event.start.dateTime);
      const h = String(start.getHours()).padStart(2, '0');
      const m = String(start.getMinutes()).padStart(2, '0');
      if (event.end?.dateTime) {
        const end = new Date(event.end.dateTime);
        const eh = String(end.getHours()).padStart(2, '0');
        const em = String(end.getMinutes()).padStart(2, '0');
        return `${h}:${m} - ${eh}:${em}`;
      }
      return h + ':' + m;
    }
    return '-';
  };

  const getChatName = (jid) => {
    const chat = chats.find(c => c.jid === jid);
    return chat?.display_name || jid;
  };

  if (loading) return React.createElement('div', { className: 'loading' }, 'טוען...');

  return React.createElement('div', null,
    React.createElement('div', { className: 'header' },
      React.createElement('h2', null, 'יומן Google'),
      React.createElement('div', { style: { display: 'flex', gap: '8px' } },
        React.createElement('button', { className: 'btn btn-secondary', onClick: triggerDailySummary }, 'שלח סיכום יומי'),
        React.createElement('button', { className: 'btn btn-primary', onClick: () => setShowAddModal(true) }, 'קשר יומן חדש')
      )
    ),

    // Calendar Links Table
    React.createElement('div', { className: 'card' },
      React.createElement('div', { className: 'card-header' },
        React.createElement('h3', null, `קישורי יומנים (${links.length})`)
      ),
      React.createElement('div', { className: 'card-body' },
        links.length === 0
          ? React.createElement('div', { className: 'empty-state' }, 'אין יומנים מקושרים. לחץ "קשר יומן חדש" כדי להתחיל.')
          : React.createElement('table', null,
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', null, 'צ׳אט'),
                  React.createElement('th', null, 'Calendar ID'),
                  React.createElement('th', null, 'שם תצוגה'),
                  React.createElement('th', null, 'ברירת מחדל'),
                  React.createElement('th', null, 'סיכום יומי'),
                  React.createElement('th', null, 'תזכורת'),
                  React.createElement('th', null, 'פעולות')
                )
              ),
              React.createElement('tbody', null,
                links.map(link =>
                  React.createElement('tr', { key: link.id },
                    React.createElement('td', null, getChatName(link.jid)),
                    React.createElement('td', { style: { fontSize: '12px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' } }, link.calendar_id),
                    React.createElement('td', null, link.display_name || '-'),
                    React.createElement('td', null,
                      React.createElement('span', { className: `badge ${link.is_default ? 'badge-success' : 'badge-secondary'}` },
                        link.is_default ? 'כן' : 'לא'
                      )
                    ),
                    React.createElement('td', null,
                      React.createElement('span', { className: `badge ${link.daily_summary ? 'badge-success' : 'badge-secondary'}` },
                        link.daily_summary ? 'כן' : 'לא'
                      )
                    ),
                    React.createElement('td', null,
                      link.reminder_minutes
                        ? React.createElement('span', { className: 'badge badge-success' }, link.reminder_minutes + ' דק׳')
                        : React.createElement('span', { className: 'badge badge-secondary' }, 'כבוי')
                    ),
                    React.createElement('td', null,
                      React.createElement('button', {
                        className: 'btn btn-small btn-primary',
                        onClick: () => setEditLink({ ...link })
                      }, 'ערוך'),
                      React.createElement('button', {
                        className: 'btn btn-small btn-danger',
                        onClick: () => deleteLink(link.id)
                      }, 'הסר')
                    )
                  )
                )
              )
            )
      )
    ),

    // Event Preview
    React.createElement('div', { className: 'card' },
      React.createElement('div', { className: 'card-header' },
        React.createElement('h3', null, 'תצוגה מקדימה של אירועים')
      ),
      React.createElement('div', { className: 'card-body' },
        React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'flex-end' } },
          React.createElement('div', { className: 'form-group', style: { margin: 0, flex: 1, minWidth: '150px' } },
            React.createElement('label', null, 'צ׳אט'),
            React.createElement('select', {
              value: previewJid,
              onChange: e => setPreviewJid(e.target.value)
            },
              React.createElement('option', { value: '' }, 'בחר...'),
              [...new Set(links.map(l => l.jid))].map(jid =>
                React.createElement('option', { key: jid, value: jid }, getChatName(jid))
              )
            )
          ),
          React.createElement('div', { className: 'form-group', style: { margin: 0 } },
            React.createElement('label', null, 'תאריך'),
            React.createElement('input', {
              type: 'date',
              value: previewDate,
              onChange: e => setPreviewDate(e.target.value)
            })
          ),
          React.createElement('button', {
            className: 'btn btn-primary',
            onClick: loadEvents,
            disabled: !previewJid || loadingEvents
          }, loadingEvents ? 'טוען...' : 'הצג אירועים')
        ),
        events.length > 0
          ? React.createElement('table', null,
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', null, 'שעה'),
                  React.createElement('th', null, 'אירוע'),
                )
              ),
              React.createElement('tbody', null,
                events.map((ev, i) =>
                  React.createElement('tr', { key: i },
                    React.createElement('td', null, formatEventTime(ev)),
                    React.createElement('td', null, ev.summary || '(ללא כותרת)')
                  )
                )
              )
            )
          : previewJid && !loadingEvents
            ? React.createElement('div', { className: 'empty-state' }, 'אין אירועים בתאריך זה')
            : null
      )
    ),

    // Add Link Modal
    showAddModal && React.createElement('div', { className: 'modal-overlay', onClick: () => setShowAddModal(false) },
      React.createElement('div', { className: 'modal', onClick: e => e.stopPropagation() },
        React.createElement('div', { className: 'modal-header' },
          React.createElement('h3', null, 'קשר יומן חדש'),
          React.createElement('button', { className: 'modal-close', onClick: () => setShowAddModal(false) }, '\u00D7')
        ),
        React.createElement('div', { className: 'modal-body' },
          React.createElement('div', { className: 'form-group' },
            React.createElement('label', null, 'צ׳אט'),
            React.createElement('select', {
              value: newLink.jid,
              onChange: e => setNewLink({ ...newLink, jid: e.target.value })
            },
              React.createElement('option', { value: '' }, 'בחר...'),
              chats.filter(c => c.enabled).map(c =>
                React.createElement('option', { key: c.jid, value: c.jid },
                  (c.display_name || c.jid) + (c.is_group ? ' (קבוצה)' : '')
                )
              )
            )
          ),
          React.createElement('div', { className: 'form-group' },
            React.createElement('label', null, 'Calendar ID'),
            React.createElement('input', {
              type: 'text',
              value: newLink.calendar_id,
              onChange: e => setNewLink({ ...newLink, calendar_id: e.target.value }),
              placeholder: 'example@gmail.com או abc@group.calendar.google.com'
            })
          ),
          React.createElement('div', { className: 'form-group' },
            React.createElement('label', null, 'שם תצוגה (אופציונלי)'),
            React.createElement('input', {
              type: 'text',
              value: newLink.display_name,
              onChange: e => setNewLink({ ...newLink, display_name: e.target.value }),
              placeholder: 'לדוגמה: היומן המשפחתי'
            })
          ),
          React.createElement('div', { className: 'info-box' },
            'וודא שהיומן שותף עם ', React.createElement('code', null, 'bayles-calendar@gen-lang-client-0072875231.iam.gserviceaccount.com'), ' בהרשאת "לשנות אירועים".'
          )
        ),
        React.createElement('div', { className: 'modal-footer' },
          React.createElement('button', { className: 'btn btn-secondary', onClick: () => setShowAddModal(false) }, 'ביטול'),
          React.createElement('button', { className: 'btn btn-primary', onClick: addLink }, 'קשר יומן')
        )
      )
    ),

    // Edit Link Modal
    editLink && React.createElement('div', { className: 'modal-overlay', onClick: () => setEditLink(null) },
      React.createElement('div', { className: 'modal', onClick: e => e.stopPropagation() },
        React.createElement('div', { className: 'modal-header' },
          React.createElement('h3', null, 'עריכת קישור יומן'),
          React.createElement('button', { className: 'modal-close', onClick: () => setEditLink(null) }, '\u00D7')
        ),
        React.createElement('div', { className: 'modal-body' },
          React.createElement('div', { className: 'form-group' },
            React.createElement('label', null, 'שם תצוגה'),
            React.createElement('input', {
              type: 'text',
              value: editLink.display_name || '',
              onChange: e => setEditLink({ ...editLink, display_name: e.target.value })
            })
          ),
          React.createElement('div', { className: 'form-group' },
            React.createElement('label', null,
              React.createElement('input', {
                type: 'checkbox',
                checked: !!editLink.is_default,
                onChange: e => setEditLink({ ...editLink, is_default: e.target.checked ? 1 : 0 })
              }),
              ' יומן ברירת מחדל (אירועים חדשים ייוצרו כאן)'
            )
          ),
          React.createElement('div', { className: 'form-group' },
            React.createElement('label', null,
              React.createElement('input', {
                type: 'checkbox',
                checked: !!editLink.daily_summary,
                onChange: e => setEditLink({ ...editLink, daily_summary: e.target.checked ? 1 : 0 })
              }),
              ' סיכום יומי (שליחת אירועי היום כל בוקר)'
            )
          ),
          React.createElement('div', { className: 'form-group' },
            React.createElement('label', null, 'תזכורת לפני אירוע (דקות)'),
            React.createElement('select', {
              value: editLink.reminder_minutes || '',
              onChange: e => setEditLink({ ...editLink, reminder_minutes: e.target.value ? parseInt(e.target.value) : null })
            },
              React.createElement('option', { value: '' }, 'כבוי'),
              React.createElement('option', { value: '15' }, '15 דקות'),
              React.createElement('option', { value: '30' }, '30 דקות'),
              React.createElement('option', { value: '60' }, 'שעה')
            )
          )
        ),
        React.createElement('div', { className: 'modal-footer' },
          React.createElement('button', { className: 'btn btn-secondary', onClick: () => setEditLink(null) }, 'ביטול'),
          React.createElement('button', { className: 'btn btn-primary', onClick: updateLink }, 'שמור')
        )
      )
    )
  );
}

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard />;
      case 'control': return <BotControl />;
      case 'whitelist': return <Whitelist />;
      case 'activity': return <ActivityLog />;
      case 'scheduler': return <Scheduler />;
      case 'birthdays': return <Birthdays />;
      case 'groups': return <Groups />;
      case 'messages': return <Messages />;
      case 'ai': return <AISettings />;
      case 'personalities': return <Personalities />;
      case 'tenants': return <Tenants />;
      case 'contacts': return <Contacts />;
      case 'songs': return <Songs />;
      case 'calendar': return React.createElement(Calendar);
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
