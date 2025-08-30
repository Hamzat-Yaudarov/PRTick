const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

class PaymentHandler {
    constructor(bot) {
        this.bot = bot;
        this.setupHandlers();
    }

    setupHandlers() {
        // Обработка покупок пакетов
        this.bot.on('callback_query', async (callbackQuery) => {
            const action = callbackQuery.data;
            
            if (action.startsWith('buy_')) {
                const stars = parseInt(action.split('_')[1]);
                await this.handleStarPurchase(callbackQuery, stars);
            }
        });

        // Обработка успешных платежей
        this.bot.on('pre_checkout_query', async (query) => {
            // Всегда разрешаем платеж
            this.bot.answerPreCheckoutQuery(query.id, true);
        });

        this.bot.on('successful_payment', async (msg) => {
            await this.handleSuccessfulPayment(msg);
        });
    }

    async handleStarPurchase(callbackQuery, stars) {
        const chatId = callbackQuery.message.chat.id;
        const userId = callbackQuery.from.id;
        const coins = stars * 10; // курс 1⭐ = 10 коинов

        try {
            await this.bot.sendInvoice(
                chatId,
                `Пополнение на ${coins} коинов`,
                `Покупка ${coins} Tick коинов за ${stars} ⭐`,
                `stars_${userId}_${stars}_${Date.now()}`, // payload
                '', // provider_token пустой для Stars
                'XTR', // валюта
                [
                    { label: `${coins} Tick коинов`, amount: stars * 1000 } // ✅ 1⭐ = 1000
                ]
            );

        } catch (error) {
            console.error('Error creating invoice:', error);
            this.bot.answerCallbackQuery(callbackQuery.id, { 
                text: 'Ошибка создания платежа', 
                show_alert: true 
            });
        }
    }

    async handleSuccessfulPayment(msg) {
        const payment = msg.successful_payment;
        const userId = msg.from.id;
        
        try {
            // Парсим payload для получения информации о платеже
            const payloadParts = payment.invoice_payload.split('_');
            
            if (payloadParts[0] === 'stars') {
                const paidUserId = parseInt(payloadParts[1]);
                const stars = parseInt(payloadParts[2]);
                const coins = stars * 10;
                
                // Проверяем, что платеж от правильного пользователя
                if (paidUserId !== userId) {
                    console.error('Payment user mismatch');
                    return;
                }
                
                // Начисляем коины пользователю
                await pool.query(
                    'UPDATE users SET balance = balance + $1 WHERE id = $2',
                    [coins, userId]
                );
                
                // Записываем транзакцию
                await pool.query(
                    'INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                    [userId, coins, 'deposit', `Пополнение через Telegram Stars: ${stars} ⭐`]
                );
                
                // Отправляем подтверждение
                const confirmMessage = `✅ Платеж успешно обработан!\n\n` +
                                     `💰 Зачислено: ${coins} коинов\n` +
                                     `⭐ Оплачено: ${stars} Telegram Stars\n\n` +
                                     `Спасибо за пополнение! 🎉`;
                
                this.bot.sendMessage(msg.chat.id, confirmMessage);
                
                console.log(`Payment processed: ${userId} paid ${stars} stars for ${coins} coins`);
                
            } else {
                console.error('Unknown payment payload:', payment.invoice_payload);
            }
            
        } catch (error) {
            console.error('Error processing successful payment:', error);
            
            // Уведомляем пользователя об ошибке, но не возвращаем деньги автоматически
            const errorMessage = `⚠️ Произошла ошибка при обработке платежа.\n` +
                               `Платеж ID: ${payment.telegram_payment_charge_id}\n\n` +
                               `Обратитесь в поддержку для решения проблемы.`;
            
            this.bot.sendMessage(msg.chat.id, errorMessage);
        }
    }

    // Метод для проверки баланса
    async getBalance(userId) {
        try {
            const result = await pool.query('SELECT balance FROM users WHERE id = $1', [userId]);
            return result.rows[0]?.balance || 0;
        } catch (error) {
            console.error('Error getting balance:', error);
            return 0;
        }
    }

    // Метод для получения истории транзакций
    async getTransactionHistory(userId, limit = 10) {
        try {
            const result = await pool.query(
                'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
                [userId, limit]
            );
            return result.rows;
        } catch (error) {
            console.error('Error getting transaction history:', error);
            return [];
        }
    }

    // Метод для проверки возможности списания
    async canDeduct(userId, amount) {
        const balance = await this.getBalance(userId);
        return balance >= amount;
    }

    // Метод для списания средств
    async deductFunds(userId, amount, type, description) {
        try {
            const result = await pool.query(
                'UPDATE users SET balance = balance - $1 WHERE id = $2 AND balance >= $1 RETURNING balance',
                [amount, userId]
            );
            
            if (result.rows.length === 0) {
                throw new Error('Insufficient funds');
            }
            
            // Записываем транзакцию
            await pool.query(
                'INSERT INTO transactions (user_id, amount, type, description) VALUES ($1, $2, $3, $4)',
                [userId, -amount, type, description]
            );
            
            return result.rows[0].balance;
        } catch (error) {
            console.error('Error deducting funds:', error);
            throw error;
        }
    }
}

module.exports = PaymentHandler;
