const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// Подключение к базе данных MongoDB
mongoose.connect('mongodb://localhost/currency-sync-app', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});
const db = mongoose.connection;

db.on('error', (err) => console.error('Ошибка подключения к MongoDB:', err));
db.once('open', () => console.log('Соединение с MongoDB установлено'));

// Определение схемы и модели данных для курсов валют
const currencySchema = new mongoose.Schema({
    currencyCode: { type: String, required: true },
    rate: { type: Number, required: true },
    date: { type: Date, required: true },
});

const Currency = mongoose.model('Currency', currencySchema);

// Настройка cron задачи для ежедневной синхронизации данных
cron.schedule('0 1 * * *', () => {
    console.log('Запуск синхронизации данных по чешской кроне...');
    fetchAndSyncData();
});

// Функция для получения и синхронизации данных
const fetchAndSyncData = async (specifiedDate) => {
    const currentDate = specifiedDate || new Date().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '.');
    const apiEndpoint = `https://www.cnb.cz/en/financial_markets/foreign_exchange_market/exchange_rate_fixing/daily.txt?date=${currentDate}`;

    try {
        const response = await axios.get(apiEndpoint);
        const dataLines = response.data.split('\n');
        
        let headerFound = false;

        for (const line of dataLines) {
            const trimmedLine = line.trim();

            if (trimmedLine.startsWith('Country|Currency|Amount|Code|Rate')) {
                headerFound = true;
                continue;
            }

            if (headerFound && trimmedLine) {
                const [country, currency, amount, code, rate] = trimmedLine.split('|').map(item => item.trim());
                const parsedRate = parseFloat(rate.replace(',', '.'));

                if (!isNaN(parsedRate)) {
                    const existingCurrency = await Currency.findOne({ currencyCode: code, date: currentDate });

                    if (existingCurrency) {
                        existingCurrency.rate = parsedRate;
                        await existingCurrency.save();
                    } else {
                        const newCurrencyEntry = new Currency({
                            currencyCode: code,
                            rate: parsedRate,
                            date: new Date(currentDate),
                        });
                        await newCurrencyEntry.save();
                    }
                } else {
                    console.error(`Не удалось распознать курс для ${country}. Пропуск.`);
                }
            }
        }
        console.log('Данные успешно синхронизированы.');
    } catch (error) {
        console.error('Ошибка при синхронизации данных:', error.message);
    }
};

fetchAndSyncData();

// Маршрут для синхронизации данных за указанный период
app.get('/sync/:startDate/:endDate', async (req, res) => {
    const { startDate, endDate } = req.params;
    let currentDate = new Date(startDate);
    const endDateObject = new Date(endDate);

    while (currentDate <= endDateObject) {
        const formattedDate = currentDate.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '.');
        await fetchAndSyncData(formattedDate);
        currentDate.setDate(currentDate.getDate() + 1);
    }

    res.send('Данные успешно синхронизированы за указанный период.');
});

// Маршрут для получения отчета по курсу валют за период времени
app.get('/report/:startDate/:endDate/:currencies', async (req, res) => {
    const { startDate, endDate, currencies } = req.params;
    const currencyCodes = currencies.split(',');

    try {
        const report = await Currency.aggregate([
            {
                $match: {
                    date: {
                        $gte: new Date(startDate),
                        $lte: new Date(endDate),
                    },
                    currencyCode: { $in: currencyCodes },
                },
            },
            {
                $group: {
                    _id: '$currencyCode',
                    minRate: { $min: '$rate' },
                    maxRate: { $max: '$rate' },
                    avgRate: { $avg: '$rate' },
                },
            },
        ]);

        res.json(report);
    } catch (error) {
        console.error('Ошибка при получении отчета:', error.message);
        res.status(500).send('Ошибка при получении отчета.');
    }
});

// Маршрут для получения всех данных из базы данных
app.get('/allData', async (req, res) => {
    try {
        const allCurrencies = await Currency.find();
        res.json(allCurrencies);
    } catch (error) {
        console.error('Ошибка при получении всех данных:', error.message);
        res.status(500).send('Ошибка при получении всех данных.');
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер запущен и слушает порт ${PORT}`);
});
