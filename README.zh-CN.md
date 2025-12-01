# caldav-client

一个轻量级、现代化的 CalDAV 客户端，专为处理日历事件 (VEVENT) 而设计。完美支持 iCloud，基于原生 `fetch` 和 `fast-xml-parser` 实现。

> **注意**：此版本专注于日历事件 (VEVENT) 的管理，不包含待办事项 (VTODO) 的支持。

## ✨ 特性

- 🚀 **零依赖地狱**：仅依赖 `fast-xml-parser`，轻量高效。
- 🍎 **iCloud 深度支持**：内置 iCloud 自动发现和认证逻辑。
- 📅 **完整的事件管理**：支持创建、查询、更新、删除日历事件。
- 🔄 **智能同步**：支持基于 CTag 的增量同步检测，减少不必要的网络请求。
- 🔁 **重复规则支持**：支持复杂的重复事件 (Recurrence Rules) 设置。
- 🛡️ **健壮的解析**：自动处理 ICS 格式的换行、转义字符和时区转换。

## 📦 安装

```bash
npm install caldav-client
```

或使用 pnpm：

```bash
pnpm add caldav-client
```

## 🚀 快速开始

### 1. 初始化与登录

使用您的 iCloud 邮箱和**应用专用密码**进行初始化。

```javascript
const { CalDAVClient } = require('caldav-client');

// 建议使用环境变量存储凭据
const client = new CalDAVClient(
    'your-email@icloud.com',
    'your-app-specific-password' // 请务必使用应用专用密码
);

// 登录并自动发现日历主目录
const loginResult = await client.login();

if (loginResult.success) {
    console.log('登录成功！');
} else {
    console.error('登录失败:', loginResult.error);
}
```

### 2. 获取日历列表

```javascript
// 获取所有支持事件的日历
const calendars = await client.getCalendars();

calendars.forEach(cal => {
    console.log(`日历: ${cal.displayName} (ID: ${cal.id})`);
});
```

### 3. 创建新日历

```javascript
// 创建一个名为 "工作计划" 的红色日历
const newCalendar = await client.createCalendar('工作计划', '#FF0000');
```

### 4. 创建事件

#### 4.1 创建普通事件

```javascript
const eventData = {
    summary: '项目周会',
    description: '讨论下周开发计划',
    location: '会议室 A',
    startDate: '2025-12-01 14:00:00', // 支持 'YYYY-MM-DD HH:mm:ss' 格式
    endDate: '2025-12-01 15:00:00',
};

// 在指定日历中创建事件
const event = await client.createEvent(newCalendar, eventData);
console.log(`事件创建成功，UID: ${event.uid}`);
```

#### 4.2 创建带提醒的事件

```javascript
const eventWithAlarm = {
    summary: '重要会议',
    startDate: '2025-12-02 10:00:00',
    endDate: '2025-12-02 11:00:00',
    // 添加提醒：提前15分钟提醒
    alarms: [
        { action: 'DISPLAY', minutes: 15, description: '会议即将开始' }
    ]
};

await client.createEvent(newCalendar, eventWithAlarm);
```

#### 4.3 创建循环事件 (Recurring Event)

```javascript
const recurringEvent = {
    summary: '每日站会',
    startDate: '2025-12-01 09:30:00',
    endDate: '2025-12-01 09:45:00',
    // 循环规则：每天重复，共重复5次
    recurrence: {
        frequency: 'DAILY', // DAILY, WEEKLY, MONTHLY, YEARLY
        interval: 1,        // 每1天
        count: 5            // 重复5次
        // 或者使用 until: '2025-12-31' 指定截止日期
    }
};

await client.createEvent(newCalendar, recurringEvent);
```

### 5. 查询事件

```javascript
// 获取日历中的所有事件
const events = await client.getCalendarObjects(newCalendar);

// 或者指定时间范围查询
const rangeEvents = await client.getCalendarObjects(newCalendar, {
    startDate: new Date('2025-12-01'),
    endDate: new Date('2025-12-31')
});
```

### 6. 更新事件

```javascript
// 更新事件标题和时间
await client.updateEvent(newCalendar, event.uid, {
    summary: '项目周会 (改期)',
    startDate: '2025-12-01 15:00:00',
    endDate: '2025-12-01 16:00:00'
});
```

### 7. 删除事件

```javascript
await client.deleteEvent(newCalendar, event.uid);
```

### 8. 同步日历 (增量更新)

使用 `syncCalendar` 方法可以高效地检查日历是否有更新。它利用 `CTag` (Collection Tag) 机制，只有在服务器端数据发生变化时才拉取完整事件列表。

```javascript
// 首次同步，保存 ctag
let syncResult = await client.syncCalendar(newCalendar);
let lastCtag = syncResult.ctag;
console.log(`当前版本: ${lastCtag}`);

// ... 一段时间后 ...

// 再次同步，传入上次的 ctag
syncResult = await client.syncCalendar(newCalendar, lastCtag);

if (syncResult.hasChanges) {
    console.log('日历有更新！');
    console.log('最新事件列表:', syncResult.events);
    // 更新本地 ctag
    lastCtag = syncResult.ctag;
} else {
    console.log('日历无变化，无需更新。');
}
```

## 📚 API 文档

### `CalDAVClient` 类

#### `constructor(username, password)`
初始化客户端。
- `username`: iCloud 邮箱。
- `password`: 应用专用密码（在 Apple ID 官网生成）。

#### `async login()`
执行服务发现，获取 Principal 和 Calendar Home URL。
- 返回: `{ success: boolean, error?: string }`

#### `async getCalendars()`
获取所有支持 VEVENT 的日历。
- 返回: `Array<Calendar>`

#### `async createCalendar(name, color?, components?)`
创建新日历。
- `name`: 日历显示名称。
- `color`: (可选) 16进制颜色代码，如 `#FF0000`。
- `components`: (可选) 支持的组件类型，默认为 `['VEVENT']`。

#### `async createEvent(calendar, eventData)`
创建日历事件。
- `calendar`: 目标日历对象。
- `eventData`: 事件数据对象 (见下文)。

#### `async updateEvent(calendar, eventUid, eventData)`
更新现有事件。
- `calendar`: 目标日历对象。
- `eventUid`: 事件的 UID。
- `eventData`: 要更新的字段（未提供的字段将保持原样）。

#### `async deleteEvent(calendar, eventUid)`
删除指定事件。

#### `async syncCalendar(calendar, lastCtag?)`
检查日历是否有更新。
- `lastCtag`: 上次同步时保存的 CTag。
- 返回: `{ hasChanges: boolean, ctag: string, events: Array }`

### 数据结构

#### Calendar 对象
```javascript
{
    id: "...",           // 日历唯一标识
    url: "...",          // 日历服务器路径
    displayName: "...",  // 显示名称
    color: "#...",       // 颜色
    components: ["VEVENT"] // 支持的组件类型
}
```

#### EventData 对象
用于创建或更新事件：
```javascript
{
    summary: "标题",
    description: "描述",
    location: "地点",
    startDate: "2025-12-01 10:00:00", // 或 Date 对象
    endDate: "2025-12-01 11:00:00",   // 或 Date 对象
    
    // 重复规则 (可选，详见下表)
    recurrence: {
        frequency: 'DAILY',
        interval: 1,
        count: 5
    },

    // 提醒 (可选，详见下表)
    alarms: [
        { minutes: 15, action: 'DISPLAY', description: '会议即将开始' }
    ]
}
```

#### Recurrence 规则详解 (重复)

`recurrence` 对象用于定义事件的重复模式 (对应 iCalendar RRULE)。

| 属性 | 类型 | 必填 | 说明 | 示例 |
| :--- | :--- | :--- | :--- | :--- |
| `frequency` | String | **是** | 重复频率。可选值：`DAILY` (日), `WEEKLY` (周), `MONTHLY` (月), `YEARLY` (年) | `'WEEKLY'` |
| `interval` | Number | 否 | 重复间隔。默认为 1。例如 `frequency: 'WEEKLY', interval: 2` 表示每两周。 | `2` |
| `count` | Number | 否 | 重复总次数。**不可**与 `until` 同时使用。 | `5` |
| `until` | String/Date | 否 | 重复截止日期。**不可**与 `count` 同时使用。 | `'2025-12-31'` |
| `byDay` | String/Array | 否 | 指定周几。可选值：`SU`, `MO`, `TU`, `WE`, `TH`, `FR`, `SA`。 | `['MO', 'WE']` |
| `byMonth` | Number/Array | 否 | 指定月份 (1-12)。 | `[6, 12]` |
| `byMonthDay` | Number/Array | 否 | 指定月中的日期 (1-31 或负数倒数)。 | `15` |
| `weekStart` | String | 否 | 周起始日。可选值同 `byDay`。 | `'SU'` |

#### Alarm 规则详解 (提醒)

`alarms` 是一个数组，支持对象或数字简写。

**对象格式：**

| 属性 | 类型 | 必填 | 说明 | 默认值 |
| :--- | :--- | :--- | :--- | :--- |
| `minutes` | Number | **是** | 提前多少分钟触发提醒。 | - |
| `action` | String | 否 | 提醒动作。目前主要支持 `DISPLAY`。 | `'DISPLAY'` |
| `description` | String | 否 | 提醒显示的文本描述。 | `'提醒'` |

**简写格式：**
如果数组元素是数字，则直接视为 `minutes`，其他使用默认值。
例如 `alarms: [15, 60]` 等同于提前15分钟和提前60分钟提醒。

## 🛠️ 开发与测试

本项目包含完整的测试脚本。

1. 修改 `test-full.js` 中的凭据。
2. 运行测试：

```bash
node test-full.js
```

## 📄 许可证

MIT License
