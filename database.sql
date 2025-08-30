-- Создание таблицы пользователей
CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY,
    username VARCHAR(255),
    first_name VARCHAR(255),
    balance INTEGER DEFAULT 0,
    referral_count INTEGER DEFAULT 0,
    referred_by BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (referred_by) REFERENCES users(id)
);

-- Создание таблицы заданий
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    owner_id BIGINT NOT NULL,
    channel_username VARCHAR(255) NOT NULL,
    reward INTEGER NOT NULL CHECK (reward >= 15 AND reward <= 50),
    total_budget INTEGER NOT NULL,
    completed_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Создание таблицы выполненных заданий
CREATE TABLE IF NOT EXISTS task_completions (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL,
    user_id BIGINT NOT NULL,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(task_id, user_id)
);

-- Создание таблицы чатов с спонсорами
CREATE TABLE IF NOT EXISTS chats (
    id BIGINT PRIMARY KEY,
    owner_id BIGINT NOT NULL,
    chat_type VARCHAR(50) NOT NULL,
    title VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- Создание таблицы спонсоров для чатов
CREATE TABLE IF NOT EXISTS chat_sponsors (
    id SERIAL PRIMARY KEY,
    chat_id BIGINT NOT NULL,
    sponsor_username VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (chat_id) REFERENCES chats(id),
    UNIQUE(chat_id, sponsor_username)
);

-- Создание таблицы транзакций
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    amount INTEGER NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'task_reward', 'referral_bonus', 'deposit', 'task_payment'
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Индексы для оптимизации
CREATE INDEX IF NOT EXISTS idx_users_id ON users(id);
CREATE INDEX IF NOT EXISTS idx_tasks_owner_id ON tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(is_active);
CREATE INDEX IF NOT EXISTS idx_task_completions_user_task ON task_completions(user_id, task_id);
CREATE INDEX IF NOT EXISTS idx_chats_owner_id ON chats(owner_id);
CREATE INDEX IF NOT EXISTS idx_chat_sponsors_chat_id ON chat_sponsors(chat_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
