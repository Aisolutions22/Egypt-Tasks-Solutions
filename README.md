# Egypt AI Solutions Task manager

Build a complete, production-ready Arabic RTL Task Management System called **"Ai Tasks Solutions"**.

---

## CORE RULES
- Entire UI in Arabic, RTL direction (`dir="rtl"`)
- Keep these words in English only: Dashboard, Done, Home Message, Owner, Admin, Settings, Archive, Deadline
- Font: Import "Tajawal" from Google Fonts — use for all text
- Tech stack: React + TypeScript + Supabase + TailwindCSS + shadcn/ui + TanStack Query + React Router + date-fns + Resend (email)

---

## DESIGN SYSTEM

**Colors:**
- Primary accent: `#FF6B2B` (orange)
- Background: `#FFF5F0` — NOT solid white, add 3 animated CSS gradient orbs (orange tones, `filter: blur(80px)`, `opacity: 0.35`, slow float animation via `@keyframes`)
- Cards/surfaces: `rgba(255,255,255,0.85)` with `backdrop-filter: blur(12px)`
- Dark text: `#1A1A2E`
- Success green: `#059669` | Warning amber: `#D97706` | Danger red: `#DC2626` | Info blue: `#2563EB`

**Layout — Desktop:**
- Fixed sidebar on the RIGHT side (RTL), width 248px
- Sidebar has: logo area (top) → nav links → user avatar+name+role (bottom)
- Main content fills remaining space to the left, padding 28px

**Layout — Mobile (≤768px):**
- Sidebar hidden by default, slides in from right on hamburger click
- Sticky top bar: `[☰ icon LEFT] [Logo + "Ai Tasks Solutions" RIGHT]` — RTL aware
- Dark overlay behind open sidebar

---

## SUPABASE DATABASE SCHEMA

Create all tables with Row Level Security enabled:

```sql
-- 1. profiles
id uuid PK, user_id uuid FK(auth.users) UNIQUE,
full_name text, role text CHECK(role IN ('owner','admin','employee')),
color text, created_at timestamptz DEFAULT now()

-- 2. tasks
id uuid PK, title text NOT NULL, description text,
created_by uuid FK(profiles.id),
deadline timestamptz NOT NULL,
status text DEFAULT 'new' CHECK(status IN ('new','inProgress','done','closed','late')),
is_home_message boolean DEFAULT false,
home_message_expires_at timestamptz,
is_active boolean DEFAULT true,
created_at timestamptz DEFAULT now()

-- 3. task_assignments
id uuid PK, task_id uuid FK(tasks.id) ON DELETE CASCADE,
user_id uuid FK(profiles.id),
completion_percentage int DEFAULT 0 CHECK(0<=completion_percentage AND completion_percentage<=100),
employee_status text DEFAULT 'new' CHECK(employee_status IN ('new','inProgress','done')),
completed_at timestamptz,
created_at timestamptz DEFAULT now()

-- 4. task_messages
id uuid PK, task_id uuid FK(tasks.id) ON DELETE CASCADE,
sender_id uuid FK(profiles.id),
content text NOT NULL,
reply_to_id uuid FK(task_messages.id),
created_at timestamptz DEFAULT now()

-- 5. task_attachments
id uuid PK, task_id uuid FK(tasks.id),
file_url text, file_name text,
uploaded_by uuid FK(profiles.id),
created_at timestamptz DEFAULT now()

-- 6. notifications
id uuid PK, recipient_id uuid FK(profiles.id),
task_id uuid FK(tasks.id),
type text CHECK(type IN ('new_task','task_done','task_late','new_message')),
message text, is_read boolean DEFAULT false,
created_at timestamptz DEFAULT now()

-- 7. home_messages
id uuid PK, content text NOT NULL,
created_by uuid FK(profiles.id),
expires_at timestamptz NOT NULL,
is_active boolean DEFAULT true,
created_at timestamptz DEFAULT now()

-- 8. app_settings (single row)
id int DEFAULT 1 PK, default_deadline_days int DEFAULT 2
```

**RLS Policies:**
- `profiles`: users read all, update only own row
- `tasks`: owner/admin read all, employees read only tasks assigned to them (via task_assignments)
- `task_assignments`: same as tasks rule
- `task_messages`: read if assigned to task or created_by; insert if assigned or is admin/owner
- `notifications`: read/update only own notifications
- `home_messages`: all users read active ones; only admin/owner insert/update

---

## AUTHENTICATION

- Login page only — no self-registration
- Email + password Supabase auth
- Clean centered login card on the animated gradient background
- Show "Ai Tasks Solutions" logo + name above the form
- After login, redirect based on role

**First-run seed:**
Create one owner account on first deploy:
- Email: `admin@aitasks.com` / Password: `Admin@2024`
- Role: `owner`

---

## ROLES & PERMISSIONS

| Action | Owner | Admin | Employee |
|---|---|---|---|
| See all employees' tasks | ✅ | ✅ | ❌ |
| See own tasks only | ✅ | ✅ | ✅ |
| Create tasks | ❌ | ✅ | ❌ |
| Close task (Done→Archive) | ❌ | ✅ | ❌ |
| Mark task as متأخر | ❌ | ✅ | ❌ |
| Add colleagues | ✅ | ✅ | ❌ |
| Delete colleagues | ✅ | ❌ | ❌ |
| Edit settings | ✅ | ✅ | own profile only |
| Add home message | ❌ | ✅ | ❌ |

---

## PAGES & COMPONENTS

### 1. DASHBOARD (`/dashboard`)

**For Owner/Admin:**

At the very top, if an active home_message exists:
- Full-width orange gradient banner (`background: linear-gradient(135deg,#FF6B2B,#FF9A5C)`)
- Shows latest message content
- Label pill: "رسالة اليوم"
- If multiple active messages: show "+N أخرى" clickable chip → modal showing all
- **X button** on the left (RTL) → immediately sets `is_active=false` in DB
- Auto-hides when `expires_at` passes

Below banner:
- Page title: "لوحة التحكم" + date subtitle + active task count
- Top right: orange "تاسك جديد +" button

Stats row (4 cards, responsive grid):
- إجمالي التاسكات | قيد التنفيذ | متأخرة | منتهية

Employee grid (`auto-fill, minmax(270px,1fr)`, gap 18px):
- Each employee gets a card section with their avatar circle (using their color), name, task count
- Below their header: their task cards

**Task card design:**
- White glass card, 3px colored right border (employee's color)
- Title (truncated if long)
- Status badge (colored pill)
- Date created (small, muted) + Deadline (red if late)
- Progress bar + percentage if >0
- Late tasks: `border-color` pulse animation red
- Click → navigate to `/task/:id`

**For Employee:**
- Same layout but only shows tasks assigned to them
- Sorted by deadline ascending (closest first)

---

### 2. TASK DETAIL PAGE (`/task/:id`)

**Header row:**
- Back button → Dashboard
- Task title (large, bold)
- Status badge
- Admin-only action buttons: [✓ Done] [⚑ متأخر]
  - Done: confirm dialog → set status='closed', is_active=false → send in-app notification to all admins/owners
  - متأخر: set status='late' → send in-app notification to assigned employees

**Info bar (glass card):**
- "منسوب إلى": avatar chips for all assigned employees (name + colored dot)
- "تاريخ الإنشاء": formatted Arabic date
- "Deadline": date (amber color)
- "الإنجاز": show each assignee's individual percentage

**Conversation thread (below info bar, full width glass card):**

Messages list (chronological):
- Each message row: `[avatar circle] [name — bold, color of user] [date · time small muted]`
- If message has reply_to: show quoted snippet above bubble with orange right border
- Message bubble: manager messages have orange-tinted bg; employee messages have white bg
- If employee message, show their completion_percentage as orange pill
- Real-time updates via Supabase Realtime

**Input area (pinned at bottom of card):**
- Textarea: "اكتب ردك هنا..."
- Reply mode: clicking reply on any message shows quoted preview above textarea with X to cancel
- Attachment button: upload PDF → store in Supabase Storage, save URL to task_attachments
- Completion % slider (employees only, 0–100, step 1) → updates task_assignments.completion_percentage
- Send button (orange)

**On send:**
- Insert to task_messages
- If employee and percentage changed → update task_assignments
- If employee sends (any message) → create notification for admin: type='new_message'

---

### 3. ADD TASK (`/add-task`) — Admin/Owner only

Form fields:
- **عنوان التاسك** (text, required)
- **تفاصيل التاسك** (textarea, large, required)
- **منسوب إلى**: multi-select employee chips with colored avatars — toggling adds/removes; at least one required
- **Deadline**: date+time picker; default value = today + `app_settings.default_deadline_days`
- **نوع التاسك**: radio/toggle
  - "تاسك عادي" (default)
  - "Home Message — إعلان عام": if selected → show additional "مدة الظهور" picker (days: 1–7, default 2); on submit also insert into home_messages table

**On submit:**
- Insert task record
- Insert task_assignments for each selected employee (status='new', percentage=0)
- If home message → insert home_messages with expires_at = now + chosen days
- Send email to each assigned employee via Supabase Edge Function + Resend API:
  ```
  Subject: "تاسك جديد بانتظارك — Ai Tasks Solutions"
  Body: "مرحباً [اسم الموظف]،\n\nتم تكليفك بمهمة جديدة:\n[عنوان التاسك]\nالـ Deadline: [التاريخ]\n\nيرجى الدخول لعرض التفاصيل."
  ```
- Create in-app notification for each assigned employee: type='new_task'

---

### 4. ADD COLLEAGUE (`/add-colleague`) — Owner/Admin

Form fields:
- **الاسم الكامل** (text)
- **البريد الإلكتروني** (email)
- **كلمة المرور** (password, show/hide toggle)
- **الصلاحية**: 3 pill buttons → Owner / Admin / موظف (default: موظف)
- **اللون**: 12-color palette grid
  - Colors: `["#FF6B2B","#4B5EAA","#10B981","#8B5CF6","#EF4444","#F59E0B","#06B6D4","#EC4899","#84CC16","#F97316","#6366F1","#14B8A6"]`
  - Colors already used by existing profiles: show as greyed out (opacity 0.28), unclickable, tooltip "محجوز"
  - Selected color: dark border ring

**On submit:**
- `supabase.auth.admin.createUser({ email, password, email_confirm: true })`
- Insert profile record with role and color
- Show success toast

---

### 5. ARCHIVE (`/archive`) — Owner/Admin

- Card or table list of all tasks where `status = 'closed'`
- Each row: colored avatar of assignees + task title + created date + closed date + "Done" badge
- Search input to filter by title or employee name
- Click any row → opens task detail in read-only mode (no input area shown)
- Empty state: friendly Arabic illustration message

---

### 6. SETTINGS (`/settings`)

**Visible to ALL users:**
- Edit own `full_name` → save button
- Change own `color` → same 12-color palette, taken colors greyed out
- Change password (current + new + confirm)
- Dark/Light mode toggle (persisted in localStorage)

**Visible to Owner/Admin only:**
- Default Deadline Days: slider 1–7 → updates `app_settings` table
- Colleagues list: table of all profiles (name, email, role, color dot)
  - Admin can add new colleagues (link to /add-colleague)
  - Owner can delete any account (`supabase.auth.admin.deleteUser`)

---

## NOTIFICATIONS SYSTEM

**In-app bell icon** (top of sidebar, shows unread count badge):
- Dropdown on click: list of notifications (newest first)
- Each notification: colored dot + message + relative time
- Click notification → navigate to task + mark as read
- Real-time via Supabase Realtime subscription on notifications table filtered by `recipient_id = current user`

**Email notifications** (Supabase Edge Function):
- Trigger: new task assigned → email to each assigned employee
- Trigger: employee marks task as 'done' → email to all admins/owners who created or are watching

---

## USER COLOR SYSTEM

- Every profile has a unique `color` hex value
- Color appears as:
  - Avatar circle background
  - 3px right border on task cards attributed to that user
  - Message bubble accent color in conversation
  - Name text color in conversation header
- Uniqueness enforced: before inserting profile, check no other profile has same color; grey out taken colors in picker
- User can change their color in Settings → if new color is already taken, show error toast "هذا اللون محجوز لزميل آخر"

---

## TASK STATUS SYSTEM

| Status | Arabic Label | Color | Who Sets It |
|---|---|---|---|
| new | جديد | Blue `#2563EB` | Auto on create |
| inProgress | قيد التنفيذ | Amber `#D97706` | Employee |
| done | منتهي | Green `#059669` | Employee (records timestamp) |
| closed | Done | Gray `#6B7280` | Admin → moves to Archive |
| late | متأخر | Red `#DC2626` pulsing | Admin only |

Employee can only set: `inProgress`, `done`
Admin can set: all statuses

When employee sets `done`:
- Record `completed_at = now()` in task_assignments
- Create in-app notification for admins: "أحمد محمد أنهى المهمة: [عنوان التاسك]"

---

## HOME MESSAGE BANNER

- Query active home_messages: `WHERE is_active=true AND expires_at > now()` ORDER BY created_at DESC
- Show latest message in banner
- If count > 1: show chip "+N أخرى" → click opens modal/drawer listing all active messages
- Admin X button: `UPDATE home_messages SET is_active=false WHERE id=?`
- Cron or client-side check: hide if `expires_at < now()`
- Banner uses sticky positioning, appears below mobile top bar, above page content

---

## SIDEBAR NAVIGATION ORDER (RTL, icons on right of text)

1. لوحة التحكم — `Home` icon
2. إضافة تاسك — `Plus` icon — hidden for employees
3. إضافة زميل — `Users` icon — hidden for employees
4. الأرشيف — `Archive` icon — hidden for employees
5. الإعدادات — `Settings` icon

Bottom of sidebar:
- User avatar circle (their color) + full_name + role label
- Bell icon with notification count badge
- Logout icon

---

## ADDITIONAL DETAILS

**Date/time formatting** — use Arabic numerals and months everywhere:
- Dates: "الثلاثاء، ١٠ يونيو ٢٠٢٤"
- Times: "٩:٣٠ صباحاً" / "٦:٠٠ مساءً"
- Use `date-fns/locale/ar` for formatting

**Empty states:**
- Each page has a friendly Arabic empty state with icon and message
- Dashboard with no tasks: "لا توجد تاسكات نشطة حالياً — ابدأ بإضافة تاسك جديد ✨"

**Loading states:**
- Use skeleton loaders (not spinners) for all data-fetching states

**Toast notifications:**
- All success/error actions show Arabic toast (top-center)
- "تم الحفظ بنجاح ✓" / "حدث خطأ، حاول مرة أخرى"

**Confirmation dialogs:**
- Destructive actions (Done, Delete colleague): confirm dialog in Arabic
- "هل أنت متأكد؟" + Cancel "إلغاء" + Confirm button

**Mobile:**
- All grids collapse to single column on mobile
- Task cards are full width
- Task detail conversation is full screen
- All touch targets minimum 44px height

**Performance:**
- Use TanStack Query for all data with appropriate staleTime
- Supabase Realtime only on: task_messages (current open task), notifications (always)
- Optimistic updates on message send

**Security:**
- All Supabase queries filtered by authenticated user context
- RLS enforced on all tables — never bypass with service role on client
- Admin-only pages redirect non-admin users to /dashboard

---

## FINAL CHECKLIST BEFORE COMPLETING

- [ ] Login page works and redirects to dashboard
- [ ] Owner can add admin and employee accounts
- [ ] Admin can create tasks assigned to multiple employees
- [ ] Employee sees ONLY their tasks
- [ ] Task detail shows full conversation with reply feature
- [ ] Home message banner shows/hides/dismisses correctly
- [ ] Color picker blocks taken colors
- [ ] Email sent on task assignment
- [ ] In-app notification bell updates in real-time
- [ ] Archive shows closed tasks
- [ ] Settings saves all changes
- [ ] Mobile hamburger menu works
- [ ] All text is Arabic, RTL layout
- [ ] Animated background orbs visible on all pages

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://egypt-ai-tasks.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/eabba700-7558-426d-9e71-c6d66e361405).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
