# caldav-client [中文README](README.zh-CN.md)

A lightweight, modern CalDAV client designed specifically for calendar events (VEVENT). Fully supports iCloud, built on native `fetch` and `fast-xml-parser`.

> **Note**: This version focuses on Calendar Events (VEVENT) management and does not include support for To-Do items (VTODO).

## ✨ Features

- 🚀 **Zero Dependency Hell**: Only depends on `fast-xml-parser`, lightweight and efficient.
- 🍎 **Deep iCloud Support**: Built-in iCloud auto-discovery and authentication logic.
- 📅 **Complete Event Management**: Support for creating, querying, updating, and deleting calendar events.
- 🔄 **Smart Sync**: Supports incremental sync detection based on CTag to reduce unnecessary network requests.
- 🔁 **Recurrence Rules**: Supports complex recurrence event settings.
- 🛡️ **Robust Parsing**: Automatically handles ICS format line folding, escape characters, and timezone conversions.

## 📦 Installation

```bash
npm install caldav-client
```

Or using pnpm:

```bash
pnpm add caldav-client
```

## 🚀 Quick Start

### 1. Initialization & Login

Initialize with your iCloud email and **App-Specific Password**.

```javascript
const { CalDAVClient } = require('caldav-client');

// It is recommended to use environment variables for credentials
const client = new CalDAVClient(
    'your-email@icloud.com',
    'your-app-specific-password' // Make sure to use an App-Specific Password
);

// Login and automatically discover the calendar home
const loginResult = await client.login();

if (loginResult.success) {
    console.log('Login successful!');
} else {
    console.error('Login failed:', loginResult.error);
}
```

### 2. Get Calendar List

```javascript
// Get all calendars that support events
const calendars = await client.getCalendars();

calendars.forEach(cal => {
    console.log(`Calendar: ${cal.displayName} (ID: ${cal.id})`);
});
```

### 3. Create New Calendar

```javascript
// Create a red calendar named "Work Plan"
const newCalendar = await client.createCalendar('Work Plan', '#FF0000');
```

### 4. Create Event

#### 4.1 Create Basic Event

```javascript
const eventData = {
    summary: 'Project Meeting',
    description: 'Discuss next week\'s development plan',
    location: 'Meeting Room A',
    startDate: '2025-12-01 14:00:00', // Supports 'YYYY-MM-DD HH:mm:ss' format
    endDate: '2025-12-01 15:00:00',
};

// Create event in the specified calendar
const event = await client.createEvent(newCalendar, eventData);
console.log(`Event created successfully, UID: ${event.uid}`);
```

#### 4.2 Create Event with Alarm

```javascript
const eventWithAlarm = {
    summary: 'Important Meeting',
    startDate: '2025-12-02 10:00:00',
    endDate: '2025-12-02 11:00:00',
    // Add alarm: 15 minutes before
    alarms: [
        { action: 'DISPLAY', minutes: 15, description: 'Meeting starts soon' }
    ]
};

await client.createEvent(newCalendar, eventWithAlarm);
```

#### 4.3 Create Recurring Event

```javascript
const recurringEvent = {
    summary: 'Daily Standup',
    startDate: '2025-12-01 09:30:00',
    endDate: '2025-12-01 09:45:00',
    // Recurrence rule: repeat daily, 5 times
    recurrence: {
        frequency: 'DAILY', // DAILY, WEEKLY, MONTHLY, YEARLY
        interval: 1,        // Every 1 day
        count: 5            // Repeat 5 times
        // Or use until: '2025-12-31' to specify end date
    }
};

await client.createEvent(newCalendar, recurringEvent);
```

### 5. Query Events

```javascript
// Get all events in the calendar
const events = await client.getCalendarObjects(newCalendar);

// Or query by time range
const rangeEvents = await client.getCalendarObjects(newCalendar, {
    startDate: new Date('2025-12-01'),
    endDate: new Date('2025-12-31')
});
```

### 6. Update Event

```javascript
// Update event title and time
await client.updateEvent(newCalendar, event.uid, {
    summary: 'Project Meeting (Rescheduled)',
    startDate: '2025-12-01 15:00:00',
    endDate: '2025-12-01 16:00:00'
});
```

### 7. Delete Event

```javascript
await client.deleteEvent(newCalendar, event.uid);
```

### 8. Sync Calendar (Incremental Update)

Use the `syncCalendar` method to efficiently check for calendar updates. It uses the `CTag` (Collection Tag) mechanism to fetch the full event list only when server-side data has changed.

```javascript
// First sync, save ctag
let syncResult = await client.syncCalendar(newCalendar);
let lastCtag = syncResult.ctag;
console.log(`Current version: ${lastCtag}`);

// ... some time later ...

// Sync again, passing the previous ctag
syncResult = await client.syncCalendar(newCalendar, lastCtag);

if (syncResult.hasChanges) {
    console.log('Calendar has updates!');
    console.log('Latest events:', syncResult.events);
    // Update local ctag
    lastCtag = syncResult.ctag;
} else {
    console.log('No changes, no update needed.');
}
```

## 📚 API Documentation

### `CalDAVClient` Class

#### `constructor(username, password)`
Initialize the client.
- `username`: iCloud email.
- `password`: App-Specific Password (generated on Apple ID website).

#### `async login()`
Perform service discovery to get Principal and Calendar Home URL.
- Returns: `{ success: boolean, error?: string }`

#### `async getCalendars()`
Get all calendars that support VEVENT.
- Returns: `Array<Calendar>`

#### `async createCalendar(name, color?)`
Create a new calendar.
- `name`: Calendar display name.
- `color`: (Optional) Hex color code, e.g., `#FF0000`. Defaults to `#3B82F6FF`.
- Returns: `Calendar` object

#### `async updateCalendar(calendar, { name, color })`
Update calendar properties.
- `calendar`: Target calendar object.
- `name`: (Optional) New display name.
- `color`: (Optional) New color code.

#### `async deleteCalendar(calendar)`
Delete a calendar.
- `calendar`: Target calendar object.

#### `async getCalendarDetails(calendar)`
Get detailed calendar information.
- `calendar`: Target calendar object.
- Returns: `{ displayName, color, ctag, owner, privileges }`

#### `async getCalendarObjects(calendar, options?)`
Get events from a calendar.
- `calendar`: Target calendar object.
- `options`: (Optional) Query options:
  - `startDate`: Start date (Date object or string)
  - `endDate`: End date (Date object or string)
- Returns: `Array<Event>`

#### `async getEvent(calendar, uid)`
Get a single event by UID.
- `calendar`: Target calendar object.
- `uid`: Event UID.
- Returns: `Event` object or `null`

#### `async createEvent(calendar, eventData)`
Create a calendar event.
- `calendar`: Target calendar object.
- `eventData`: Event data object (see below).
- Returns: Created event object with UID

#### `async updateEvent(calendar, eventUid, eventData)`
Update an existing event.
- `calendar`: Target calendar object.
- `eventUid`: The UID of the event.
- `eventData`: Fields to update (omitted fields will remain unchanged).

#### `async deleteEvent(calendar, eventUid)`
Delete a specified event.
- `calendar`: Target calendar object.
- `eventUid`: The UID of the event.

#### `async syncCalendar(calendar, lastCtag?)`
Check if the calendar has updates.
- `calendar`: Target calendar object.
- `lastCtag`: The CTag saved from the last sync.
- Returns: `{ hasChanges: boolean, ctag: string, events: Array, message: string }`

### Data Structures

#### Calendar Object
```javascript
{
    id: "...",           // Unique calendar ID
    url: "...",          // Calendar server path
    displayName: "...",  // Display name
    color: "#...",       // Color
    components: ["VEVENT"] // Supported component types
}
```

#### EventData Object
Used for creating or updating events:
```javascript
{
    summary: "Title",
    description: "Description",
    location: "Location",
    startDate: "2025-12-01 10:00:00", // or Date object
    endDate: "2025-12-01 11:00:00",   // or Date object
    
    // Recurrence Rule (Optional, see table below)
    recurrence: {
        frequency: 'DAILY',
        interval: 1,
        count: 5
    },

    // Alarms (Optional, see table below)
    alarms: [
        { minutes: 15, action: 'DISPLAY', description: 'Meeting starts soon' }
    ]
}
```

#### Recurrence Rules

The `recurrence` object defines event repeat patterns (corresponds to iCalendar RRULE).

| Property | Type | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `frequency` | String | **Yes** | Repeat frequency. Options: `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY` | `'WEEKLY'` |
| `interval` | Number | No | Repeat interval. Default is 1. E.g., `frequency: 'WEEKLY', interval: 2` means every 2 weeks. | `2` |
| `count` | Number | No | Total number of occurrences. **Cannot** be used with `until`. | `5` |
| `until` | String/Date | No | End date for recurrence. **Cannot** be used with `count`. | `'2025-12-31'` |
| `byDay` | String/Array | No | Specify days of week. Options: `SU`, `MO`, `TU`, `WE`, `TH`, `FR`, `SA`. | `['MO', 'WE']` |
| `byMonth` | Number/Array | No | Specify months (1-12). | `[6, 12]` |
| `byMonthDay` | Number/Array | No | Specify days of month (1-31 or negative for counting from end). | `15` |
| `weekStart` | String | No | Week start day. Same options as `byDay`. | `'SU'` |

#### Alarm Rules

The `alarms` array supports object format or number shorthand.

**Object Format:**

| Property | Type | Required | Description | Default |
| :--- | :--- | :--- | :--- | :--- |
| `minutes` | Number | **Yes** | Minutes before event to trigger alarm. | - |
| `action` | String | No | Alarm action. Currently supports `DISPLAY`. | `'DISPLAY'` |
| `description` | String | No | Text description for the alarm. | `'Reminder'` |

**Shorthand Format:**
If array elements are numbers, they are treated as `minutes` with default values for other properties.
Example: `alarms: [15, 60]` equals two alarms at 15 and 60 minutes before.

## 🛠️ Development & Testing

This project includes complete test scripts.

1. Modify credentials in `test-full.js`.
2. Run tests:

```bash
node test-full.js
```

## 📄 License

MIT License
