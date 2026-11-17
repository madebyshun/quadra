# Rà soát giao diện, tính năng và hướng phát triển stocks

Ngày kiểm tra: 17/11/2026, khoảng 10:34–10:40, Asia/Ho_Chi_Minh. Chỉ đọc dữ liệu và lấy quote; không kết nối ví, ký, thanh toán hoặc gửi giao dịch. Thay đổi giao diện đang ở localhost, chưa push production.

## Giao diện đã sửa

- `/api`, `/docs`, `/verify` và trang không tồn tại cùng dùng `Page.tsx`. Trước đây shell này giữ icon dọc bên phải và cửa sổ 460 px, khác desktop mới.
- Dùng lại Desktop chung cho cả bốn trang. Icon, folder, tài liệu và Trash thống nhất với trang chủ. Công cụ mở từ trang tài liệu chuyển tới đúng cửa sổ trên desktop.
- Cửa sổ tài liệu mở rộng tối đa 960 px trên màn lớn; vẫn kéo, resize và thu nhỏ được. Không ép các biểu mẫu giao dịch thành toàn màn hình.
- Link quay về được đưa về góc desktop. Danh sách trong Docs có khoảng cách dòng thay vì các hàng sát nhau.
- Bỏ câu lỗi thời “app chưa được deploy”; sửa mô tả API/Docs vốn nói có thể trả tiền cho mọi x402 URL trong khi `x402Others` đang tắt.
- `/about` là trang marketing riêng, không dùng shell này; không phát hiện lỗi tràn ngang trong lần kiểm tra.

Kiểm tra trình duyệt: đã đo cửa sổ Docs/API rộng 960 px trên màn lớn; rà cả bốn route ở màn nhỏ, scrollWidth không vượt clientWidth. Viewport nhỏ thực tế có lúc là 300 CSS px do zoom của trình duyệt; không gọi đó là phép đo 390 CSS px. Viewport override đã được reset.

## Mức xác minh tính năng

Gate: **2354 tests / 135 files, coverage 100% statements, branches, functions, lines; build thành công**. Có thêm kiểm tra điều hướng từ desktop trên trang tài liệu. Test tự động dùng nguồn giả lập, không chứng minh dịch vụ ngoài luôn hoạt động.

Đã mở bằng trình duyệt thật 16 cửa sổ: Wallet, Terminal, Markets, Check, Send, Swap, Trade, Launch, Coins, Treasury Basket, Weekend, x402, MCP, Task Manager, Rugsweeper và My Computer. Tất cả render tiêu đề/cửa sổ tương ứng. Đây là smoke test mở giao diện, không phải bằng chứng giao dịch end-to-end.

| Nhóm | Kết quả đo thực tế | Giới hạn / việc còn lại |
| --- | --- | --- |
| Catalog API | Local trả 200, 9 skills, `selling: false`; production trả 200, `selling: true` | Local chưa bật thu phí, không phải production cũng tắt; chưa thanh toán thử trong lần này |
| Stocks / Markets | `/api/stocks/base` trả 200; trang đầu 100 records và có next_page_token; mã ứng dụng đã đọc phân trang | Có trong danh mục không chứng minh có supply hay mua bán được |
| Launch Radar | `radar 1` chạy thực tế, đọc được hai pool mới trong mẫu | Mẫu theo thời điểm, không phải toàn bộ DEX |
| Check / Token Gate | Gate AAPLc chạy, có kết quả simulation | Full sell bị revert trong mẫu, partial sell đi qua. Không suy ra AAPLc là honeypot từ một mẫu; cần phân biệt issuer controls, tuyến và lỗi quote |
| Trade Depth / Relay | Sáu quote NVDAc $1k/$10k/$100k hai chiều đều bị từ chối | Quote đối chứng $1 USDC sang WETH và NVDAc đều trả HTTP 429. Có bằng chứng rate limit từ nguồn hiện tại, chưa có bằng chứng riêng NVDAc hỏng |
| Coins / leaderboard / charts / About stats | Local và production index trả 200 | **Production syncedTo 54,604,550, head 58,481,491, behind 3,876,941 block**; local behind 6,195,050 ở mẫu trước. HTTP 200 không có nghĩa số liệu đã mới |
| Weekend | Scorecard local trả 200 | Diary local và production trả 502, chi tiết upstream Blue Agent 404. Phải sửa tích hợp theo endpoint đã xác minh; không đổi repo Blue Agent |
| Send / Swap / Trade / Launch / Basket | Giao diện mở và các logic kiểm tra có test tự động | Không gửi giao dịch thật trong lần kiểm tra. Basket trước đó chủ dự án đã mua thành công, nhưng không thay cho kiểm tra lại khi provider đang 429 |
| Wallet / MCP / game / settings | Giao diện mở; có test tự động | Chưa ghép ví điện thoại hoặc chạy MCP client bên ngoài trong lần này |
| Chức năng tắt | Robinhood Chain, inference, audit, hooks, webhooks, x402 external flows | Đang tắt bằng cấu hình, không phải tất cả nút tương ứng đều là tính năng đã chạy |

## Ưu tiên sửa trước khi thêm tính năng

1. **Index freshness và backfill**: xử lý backlog production, kiểm tra RPC/archive, lưu tiến độ và ngân sách mỗi lượt. Cron hiện một lần/ngày; handler có vòng sync theo budget, vì vậy không thể kết luận chỉ đổi cron là đủ. Đặt freshness SLO, hiển thị mốc sync và độ trễ cho số liệu phụ thuộc index. Không hiển thị số cũ như hiện tại.
2. **Relay rate limit**: backoff có giới hạn, giãn quote theo luồng, coalesce/cancel quote đã cũ; phân biệt 429, không có route và lỗi simulation. Khi ký phải lấy quote mới; không tái sử dụng payload quote hết hạn. Không nới kiểm tra spender/target để chữa lỗi 429.
3. **Weekend Diary**: xác minh endpoint hiện tại hoặc giữ thông báo unavailable rõ ràng; không giả lập diary rỗng là thành công.
4. **Stock-aware preflight**: phân biệt quyền của issuer B20 với quyền của creator memecoin; giữ cảnh báo transfer policy/pause và simulation. Chỉ có token approval không đảm bảo transfer thành công.

## Nghiên cứu stocks trên Base

Nguồn chính thức được đọc ngày 17/11/2026:

- [Tokenized Stocks API](https://docs.base.org/sdks/tokenized-stocks/overview): API chỉ đọc, không cần key, có phân trang; chứa supply, multiplier, NAV, thời gian NAV và corporate actions. API không cung cấp cost basis, lịch sử giao dịch ví hoặc PnL. NAV là giá tham chiếu, không phải giá thực thi.
- [Tích hợp tokenized stocks](https://docs.base.org/build-on-base/integrate-defi/list-tokenized-stocks): nhận diện bằng contract address; B20 có policy và pause; approval không policy-gated. Multiplier thay đổi quyền quy đổi cổ phiếu, số token không mặc định bằng số cổ phiếu. Tài liệu hiện tại có helper ERC-8056; không dùng bài blog cũ nói tính năng còn ở tương lai làm mô tả trạng thái hiện tại.
- [Request for Builders](https://www.base.org/blog/request-for-builders-tokenized-stocks): danh mục cá nhân hóa, stock-linked communities và agents là các hướng Base nêu cho builders.
- [Aave V4 stocks](https://aave.com/blog/coinbase-tokenized-stocks): bảy cổ phiếu công nghệ làm collateral vay USDC; đây là nền để mở rộng Collateral Watch, không phải lý do hứa lợi nhuận hay khả năng vay cho mọi tài sản.
- [Stocks Maxxing Season](https://www.base.org/stocksmaxxing): lịch công bố 5/11–5/12, có hướng mở rộng dự án đã live bằng tính năng stock-linked; điều kiện tham gia cần đối chiếu Official Rules nếu nộp. Chưa nộp hay liên hệ ai.

## Đề xuất build theo thứ tự

### 1. `stocks / health`

Một cửa sổ tổng hợp sức khỏe thực thi, mở từ Markets, Basket và Launch. Tái sử dụng các thành phần hiện có thay vì làm lại Trade Depth hoặc Weekend.

- Contract đã xác minh, supply, trạng thái mint, pause/policy, reference NAV và thời gian cập nhật.
- Giá mua/bán theo số tiền người dùng định dùng; tổng phí, price impact và chênh NAV hiển thị riêng.
- Trạng thái rõ: ready, rate limited, no route, stale reference, transfer restricted, not checked.
- Trước khi ký, refresh quote và simulate bằng tài khoản thực. Không biến một phép đọc lỗi thành pass.

Lợi ích: giải quyết vấn đề thực tế vừa đo được, đồng thời tạo lớp dữ liệu dùng chung cho các sản phẩm stocks khác.

### 2. `basket / rebalance`

Mở rộng Treasury Basket hiện có từ mua/top-up sang quản lý phân bổ.

- Lưu target weights, cho xem drift và kế hoạch mua/bán trước khi thực hiện.
- Cho người dùng đặt ngưỡng drift, ngân sách, slippage và mức tiền nhỏ bỏ qua; không tự bán khi chưa được yêu cầu.
- Chỉ thêm tiền hoặc tái cân bằng bằng cả mua/bán là hai lựa chọn rõ ràng.
- Dùng batch khi ví hỗ trợ; không hứa một confirmation cho mọi ví. Chưa làm vault/index token mới ở bước này.

### 3. `stocks / activity`

Sổ sự kiện stock trong ví, trình bày như file desktop.

- Theo dõi multiplier và corporate actions; giải thích thay đổi số cổ phiếu tương đương dù raw token balance giữ nguyên.
- Lưu receipt từ giao dịch Quadra và xuất CSV. Nếu chỉ có giao dịch qua Quadra, ghi rõ phạm vi đó.
- PnL chỉ hiển thị khi có cost basis đủ dữ liệu. Không lấy balance hiện tại trừ tiền nạp rồi gọi là PnL.

### 4. `launch / pair health`

Đưa health check vào quy trình launch stock-paired: trạng thái quote trong factory, khả năng mua/bán tài sản quote, quyền chuyển, FDV mở cửa theo token và đơn vị cổ phiếu. Tái sử dụng PairExposure đã có. Chưa thay đổi cơ chế phí hoặc deploy adapter/contract mới.

Đề xuất chọn: sửa ba điểm vận hành trước, tiếp theo build `stocks / health`, rồi `basket / rebalance`. Các tính năng trên là đề xuất, chưa triển khai trong lần rà soát này.
