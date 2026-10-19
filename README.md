# Hivetrader

Hivetrader is a tool designed to facilitate the analysis of trades in Hive's internal market.

## Technologies Used

- **TypeScript**: The main language used for development.
- **JavaScript**: Used to complement functionalities in a minor way.
- **Vite**: A fast build tool for modern applications.
- **Tailwind CSS**: A CSS framework for responsive and modern design.

## Installation

To install Hivetrader, follow these steps:

1. Clone the repository:
   ```bash
   git clone https://github.com/manu38ale/hivetrader.git
   ```
2. Navigate to the project directory:
   ```bash
   cd hivetrader
   ```
3. Install the dependencies:
   ```bash
   npm install
   ```

## Usage

To start the application, run the following command:

```bash
npm run dev
```

This will start a development server, and you can access the application at `http://localhost:3000`.

## Dedicated market-making bot

The dashboard remains read-only. The isolated Node.js bot, paper/live setup,
risk controls and historical simulator are documented in [bot/README.md](bot/README.md).
Install its dependencies with `npm --prefix bot ci`; root `npm test`, `npm run paper`
and `npm run backtest` delegate to that package.

To prefill the dedicated bot-monitoring page, copy
[.env.example](.env.example) to `.env` and set `VITE_BOT_ACCOUNT` to its public name.
Never put a private key in a `VITE_*` variable: Vite exposes these to the browser.
The main menu separates **Historical analysis** (`#/analysis`) from **Bot trading**
(`#/bot`). Analysis retains its account selector, dates, HBD cash-flow summary and
fill history; switching pages preserves each page's account and period selections.
The bot page shows liquid HIVE/HBD balances (available plus reserved), HBD equity,
trading P&L and gross volume for 24 hours, 7 days, 30 days or all history, followed
by open orders and paginated executed trades. Its public order book shows ten
levels per side from a 50-level snapshot.

Bot balances/orders refresh every 15 seconds; fills refresh every 60 seconds.
Trading P&L = net HBD from fills + net HIVE from fills × current internal-market
mid. Funding is not treated as profit; pre-period inventory revaluation is not
included. This is not the analysis page's net HBD cash flow, FIFO realized profit,
or the running bot's daily equity breaker. Snapshot balances always show the
current account, irrespective of the selected trade-history period.

History requests fail explicitly rather than reporting partial results if RPC
pagination fails or a period exceeds 100,000 account-history entries. Select a
shorter period for very active accounts. The page is read-only: it displays real
on-chain activity and cannot see virtual paper-mode orders or whether the bot
process is running. No private keys or signing controls are exposed.

Reference prices come exclusively from Hive's
`condenser_api.get_current_median_history_price`: HIVE is displayed in HBD and
HBD in HIVE, with the reciprocal calculated from the feed's base/quote assets.
No external USD quote or fabricated fallback is used. If the feed fails,
the dashboard displays an explicit error. This reference feed is distinct from
the executable order-book prices used by the bot for quotes and HBD equity.

## Contributing

Contributions are welcome! If you would like to contribute, please follow these steps:

1. Fork the project.
2. Create your feature branch (`git checkout -b feature/new-feature`).
3. Make your changes and commit them (`git commit -m 'Add new feature'`).
4. Push to the branch (`git push origin feature/new-feature`).
5. Open a Pull Request.

## License

This project is licensed under the MIT License.

## Contact

For more information, you can contact [manu38ale@gmail.com].

---

Thank you for your interest in Hivetrader!
