require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDatabase() {
    try {
        console.log('🔄 Инициализация баз�� данных...');
        
        // Читаем SQL скрипт
        const sqlScript = fs.readFileSync(path.join(__dirname, 'database.sql'), 'utf8');
        
        // Выполняем SQL скрипт
        await pool.query(sqlScript);
        
        console.log('✅ Таблицы базы данных успешно созданы!');
        console.log('📋 Созданы таблицы:');
        console.log('   - users (пользователи)');
        console.log('   - tasks (задания)');
        console.log('   - task_completions (выполненные задания)');
        console.log('   - chats (чаты с ботом)');
        console.log('   - chat_sponsors (спонсоры чатов)');
        console.log('   - transactions (транзакции)');
        
        // Проверяем созданные таблицы
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        console.log('\n📊 Найденные таблицы в базе данных:');
        result.rows.forEach(row => {
            console.log(`   ✓ ${row.table_name}`);
        });
        
    } catch (error) {
        console.error('❌ Ошибка инициализации базы данных:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    initDatabase()
        .then(() => {
            console.log('\n🎉 Инициализация завершена успешно!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Ошибка при инициализации:', error);
            process.exit(1);
        });
}

module.exports = { initDatabase };
