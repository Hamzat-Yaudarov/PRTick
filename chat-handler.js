const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

class ChatHandler {
    constructor(bot) {
        this.bot = bot;
        this.setupHandlers();
    }

    setupHandlers() {
        // Обработка добавления бота в чат
        this.bot.on('new_chat_members', async (msg) => {
            const newMembers = msg.new_chat_members;
            const botId = await this.bot.getMe().then(me => me.id);
            
            // Проверяем, добавили ли бота
            const botAdded = newMembers.some(member => member.id === botId);
            
            if (botAdded) {
                await this.handleBotAddedToChat(msg);
            } else {
                // Проверяем новых участников на подписки спонсоров
                await this.checkNewMembersSubscriptions(msg, newMembers);
            }
        });

        // Обработка сообщений в чатах
        this.bot.on('message', async (msg) => {
            if (msg.chat.type !== 'private' && !msg.new_chat_members) {
                await this.checkMessagePermission(msg);
            }
        });

        // Команды для управления спонсорами
        this.bot.onText(/\/add_sponsor (.+)/, async (msg, match) => {
            await this.addSponsor(msg, match[1]);
        });

        this.bot.onText(/\/remove_sponsor (.+)/, async (msg, match) => {
            await this.removeSponsor(msg, match[1]);
        });

        this.bot.onText(/\/sponsors/, async (msg) => {
            await this.listSponsors(msg);
        });
    }

    async handleBotAddedToChat(msg) {
        const chatId = msg.chat.id;
        const chatType = msg.chat.type;
        const chatTitle = msg.chat.title;
        const ownerId = msg.from.id;

        try {
            // Сохраняем информацию о чате
            await pool.query(
                'INSERT INTO chats (id, owner_id, chat_type, title) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET owner_id = $2, title = $3',
                [chatId, ownerId, chatType, chatTitle]
            );

            const welcomeMessage = `🎉 Добро пожаловать в Tick Bot!\n\n` +
                                 `Теперь я буду следить за подписками участников на спонсорские каналы.\n\n` +
                                 `📋 Команды для администраторов:\n` +
                                 `/add_sponsor @channel - добавить спонсора\n` +
                                 `/remove_sponsor @channel - удалить спонсора\n` +
                                 `/sponsors - список спонсоров\n\n` +
                                 `⚠️ Участники смогут писать только после подписки на всех спонсоров!`;

            this.bot.sendMessage(chatId, welcomeMessage);
        } catch (error) {
            console.error('Error handling bot added to chat:', error);
        }
    }

    async checkNewMembersSubscriptions(msg, newMembers) {
        const chatId = msg.chat.id;
        
        for (const member of newMembers) {
            if (member.is_bot) continue;
            
            const hasRequiredSubscriptions = await this.checkUserSubscriptions(chatId, member.id);
            
            if (!hasRequiredSubscriptions) {
                const sponsors = await this.getChatSponsors(chatId);
                if (sponsors.length > 0) {
                    const sponsorsList = sponsors.map(s => `@${s.sponsor_username}`).join('\n');
                    
                    const message = `👋 ${member.first_name}, добро пожаловать!\n\n` +
                                   `Для участия в чате подпишитесь на спонсоров:\n\n` +
                                   `${sponsorsList}\n\n` +
                                   `После подписки напишите любое сообщение для проверки.`;
                    
                    try {
                        await this.bot.sendMessage(chatId, message);
                    } catch (error) {
                        console.error('Error sending welcome message:', error);
                    }
                }
            }
        }
    }

    async checkMessagePermission(msg) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        // Проверяем, есть ли у пользователя права администратора
        try {
            const chatMember = await this.bot.getChatMember(chatId, userId);
            if (['administrator', 'creator'].includes(chatMember.status)) {
                return; // Администраторы могут писать всегда
            }
        } catch (error) {
            console.error('Error checking admin status:', error);
        }

        const hasRequiredSubscriptions = await this.checkUserSubscriptions(chatId, userId);
        
        if (!hasRequiredSubscriptions) {
            const sponsors = await this.getChatSponsors(chatId);
            if (sponsors.length > 0) {
                try {
                    // Удаляем сообщение
                    await this.bot.deleteMessage(chatId, msg.message_id);
                    
                    const sponsorsList = sponsors.map(s => `@${s.sponsor_username}`).join('\n');
                    
                    const warningMessage = `⚠️ ${msg.from.first_name}, для участия в чате подпишитесь на спонсоров:\n\n` +
                                         `${sponsorsList}\n\n` +
                                         `��осле подписки попробуйте снова.`;
                    
                    // Отправляем предупреждение и удаляем его через 10 секунд
                    const warningMsg = await this.bot.sendMessage(chatId, warningMessage);
                    setTimeout(() => {
                        this.bot.deleteMessage(chatId, warningMsg.message_id).catch(() => {});
                    }, 10000);
                    
                } catch (error) {
                    console.error('Error deleting message or sending warning:', error);
                }
            }
        }
    }

    async checkUserSubscriptions(chatId, userId) {
        const sponsors = await this.getChatSponsors(chatId);
        
        if (sponsors.length === 0) {
            return true; // Нет спонсоров - можно писать
        }

        for (const sponsor of sponsors) {
            try {
                const chatMember = await this.bot.getChatMember(`@${sponsor.sponsor_username}`, userId);
                if (!['member', 'administrator', 'creator'].includes(chatMember.status)) {
                    return false;
                }
            } catch (error) {
                console.error(`Error checking subscription to ${sponsor.sponsor_username}:`, error);
                return false; // В случае ошибки считаем, что не подписан
            }
        }
        
        return true;
    }

    async getChatSponsors(chatId) {
        try {
            const result = await pool.query(
                'SELECT * FROM chat_sponsors WHERE chat_id = $1 ORDER BY created_at',
                [chatId]
            );
            return result.rows;
        } catch (error) {
            console.error('Error getting chat sponsors:', error);
            return [];
        }
    }

    async addSponsor(msg, sponsorUsername) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        // Проверяем права администратора
        try {
            const chatMember = await this.bot.getChatMember(chatId, userId);
            if (!['administrator', 'creator'].includes(chatMember.status)) {
                this.bot.sendMessage(chatId, '❌ Только администраторы могут управлять спонсорами.');
                return;
            }
        } catch (error) {
            console.error('Error checking admin rights:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка проверки прав.');
            return;
        }

        const cleanUsername = sponsorUsername.replace('@', '');
        
        try {
            await pool.query(
                'INSERT INTO chat_sponsors (chat_id, sponsor_username) VALUES ($1, $2)',
                [chatId, cleanUsername]
            );
            
            this.bot.sendMessage(chatId, `✅ Спонсор @${cleanUsername} добавлен!`);
        } catch (error) {
            if (error.code === '23505') { // Unique constraint violation
                this.bot.sendMessage(chatId, `⚠️ Спонсор @${cleanUsername} уже добавлен.`);
            } else {
                console.error('Error adding sponsor:', error);
                this.bot.sendMessage(chatId, '❌ Ошибка добавления спонсора.');
            }
        }
    }

    async removeSponsor(msg, sponsorUsername) {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        
        // Проверяем права администратора
        try {
            const chatMember = await this.bot.getChatMember(chatId, userId);
            if (!['administrator', 'creator'].includes(chatMember.status)) {
                this.bot.sendMessage(chatId, '❌ Только администраторы могут управлять спонсорами.');
                return;
            }
        } catch (error) {
            console.error('Error checking admin rights:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка проверки прав.');
            return;
        }

        const cleanUsername = sponsorUsername.replace('@', '');
        
        try {
            const result = await pool.query(
                'DELETE FROM chat_sponsors WHERE chat_id = $1 AND sponsor_username = $2',
                [chatId, cleanUsername]
            );
            
            if (result.rowCount > 0) {
                this.bot.sendMessage(chatId, `✅ Спонсор @${cleanUsername} удален!`);
            } else {
                this.bot.sendMessage(chatId, `⚠️ Спонсор @${cleanUsername} не найден.`);
            }
        } catch (error) {
            console.error('Error removing sponsor:', error);
            this.bot.sendMessage(chatId, '❌ Ошибка удаления спонсора.');
        }
    }

    async listSponsors(msg) {
        const chatId = msg.chat.id;
        
        const sponsors = await this.getChatSponsors(chatId);
        
        if (sponsors.length === 0) {
            this.bot.sendMessage(chatId, '📋 Спонсоры не добавлены.');
            return;
        }
        
        let message = '📋 Список спонсоров:\n\n';
        sponsors.forEach((sponsor, index) => {
            message += `${index + 1}. @${sponsor.sponsor_username}\n`;
        });
        
        this.bot.sendMessage(chatId, message);
    }
}

module.exports = ChatHandler;
