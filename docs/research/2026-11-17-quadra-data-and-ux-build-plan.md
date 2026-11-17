# Plan dữ liệu và trải nghiệm người dùng cho Quadra

Ngày nghiên cứu: 17/11/2026. Trạng thái: đề xuất để duyệt, **chưa triển khai code, chưa đổi cấu hình hoặc push/deploy** trong lần nghiên cứu này. Không sửa repository Blue Agent. Phạm vi Blue Agent chỉ gồm lớp dữ liệu phục vụ Quadra, không nghiên cứu lại chat, agent marketplace hay BaseCity.

## 1. Quyết định sản phẩm đề xuất

Quadra là nơi người dùng xem, quyết định, thực hiện và theo dõi hành động stocks trên Base. Blue Agent cung cấp ngữ cảnh và dữ liệu phân tích dùng chung. Hai nguồn có trách nhiệm khác nhau:

| Chủ thể | Trách nhiệm |
| --- | --- |
| Blue Agent | Snapshot giá tham chiếu/DEX, oracle gap, thị trường, scorecard, bộ lọc; nguồn và phạm vi quan sát |
| Quadra launchpad index | Coin do Quadra launch, swaps, creators, referrals, candles và thống kê phát sinh từ các contract riêng |
| Coinbase/B20 trực tiếp | Danh tính contract, multiplier, supply/policy/pause tại thời điểm kiểm tra; dùng đối chiếu dữ liệu phân tích |
| Execution provider + RPC | Quote cho đúng số tiền/tài khoản, allowance, spender/target, simulation và receipt; snapshot Blue Agent không thay thế bước này |

Không chuyển launchpad index sang Blue Agent chỉ vì hai sản phẩm kết nối. Không coi một giá pool hoặc NAV là lời hứa về giá mua/bán.

## 2. Những gì Blue Agent đang cung cấp — đã kiểm tra

GET `https://blueagent.dev/api/catalog` trả 200, 30 entries ngày 17/11. Chỉ gọi hai endpoint được catalog ghi miễn phí; không gọi trả phí, không thanh toán.

| Dữ liệu | Khả năng hiện tại | Phạm vi xác minh |
| --- | --- | --- |
| `hood-live`, chain=base | Miễn phí; snapshot oracle/DEX và freshness | POST thực tế 200. `base_desk.count=12`; coverage ghi catalog_total=338, observed=12, not_assessed=326. **326 mã chưa được poller đánh giá, không phải 326 mã không có thanh khoản** |
| `weekend-scorecard` | Miễn phí; theo ticker/số tuần | POST AAPL/4 tuần trả 200. `ready=false`, calls=0, needed=30, hit_rate=null. Không được biến null thành 0% hay lấy headline marketing làm bằng chứng dự đoán |
| `base-stock-quote` | Catalog ghi $0.02/lần; oracle, pool, drift, thanh khoản | Mới xác minh schema/mô tả và sample provenance=shape, chưa xác minh response trả phí |
| `base-stock-movers` | Catalog ghi $0.03/lần | Mới xác minh discovery, chưa xác minh thực thi |
| `stock-screen` | Catalog ghi $0.02/lần; lọc drift/liquidity/oracle age | Mới xác minh discovery, chưa xác minh thực thi |
| `pre-trade-check` | Miễn phí; kiểm tra địa chỉ/token trước ký | Có trong catalog, chưa gọi thực tế trong lần nghiên cứu này |
| Corporate actions | Website quảng bá; API Coinbase có endpoint tương ứng | **Không tìm thấy tool corporate-actions riêng trong 30 entries hiện tại.** Cần chốt hợp đồng dữ liệu Blue Agent hoặc dùng nguồn Coinbase có attribution; chưa hứa đã tích hợp |
| Weekend Diary | Tích hợp Quadra hiện tại bị upstream 404 ở lần audit trước | Không có entry `weekend-diary` trong catalog hiện tại. Không đoán URL thay thế |

Trong mẫu `hood-live`: top-level data_age_seconds=145, is_stale=false, stale_after_seconds=900, còn `base_desk.as_of` có mốc riêng. Freshness phải được tính theo đúng dataset/row, không sao chép cờ fresh ở ngoài cho toàn bộ assets. Coverage catalog_checked_at=2026-11-11 cũng có tuổi riêng.

Các tool có prefix `rh-` phục vụ Robinhood Chain; không dùng cho Quadra Base chỉ vì ticker giống nhau.

## 3. Hợp đồng dữ liệu cần chốt

Đề xuất một adapter server-side trong Quadra, chỉ nhận các endpoint cố định đã xác minh. Chuẩn hóa kết quả về schema có version; giữ raw provenance để truy vết, không sửa nội dung nguồn thành kết luận chắc chắn hơn.

Mỗi bản ghi cần: chainId + contract address; ticker để hiển thị; provider; source URL; observedAt; fetchedAt; referenceUpdatedAt; nguồn giá và đơn vị (USD/token hay USD/share); multiplier cùng thời điểm; trạng thái coverage/freshness/error. Trường thiếu là unknown, không mặc định bằng 0.

Các trạng thái riêng: `ready`, `stale`, `unavailable`, `not_assessed`, `rate_limited`, `restricted`, `not_enough_history`. Freshness và coverage là hai trục, không gộp thành một điểm “an toàn”.

Cache theo endpoint + tham số + chain + contract; tránh gộp quotes của các ví khác nhau. Tôn trọng TTL nguồn và hợp đồng khai thác/cache; giữ last-known-good kèm tuổi dữ liệu để xem tham khảo. Không dùng last-known-good làm quote ký giao dịch. Giới hạn số yêu cầu, timeout, retry có ngân sách và circuit breaker khi upstream lỗi.

Chi phí: browse thông thường ưu tiên nguồn miễn phí. Không thu một lượt x402 cho mỗi tile/render/poll. Với dữ liệu trả phí cần quyết định ai trả, ngân sách, phạm vi cache và cách báo người dùng trước; chưa bật thanh toán ngầm hoặc mở lại `x402Others` chỉ để có dữ liệu.

## 4. Index Quadra — vấn đề và hướng sửa

### Bằng chứng đã có

Audit trước đo production: syncedTo=54,604,550; head=58,481,491; behind=3,876,941. Đây là mẫu ngày 17/11, không phải phép đo liên tục. Code hiện tại:

- `CHUNK=1000`, `MAX_CHUNKS=10`, budget lưu trữ 20 giây. Có vòng lặp nhiều batch trong budget, không thể suy ra mỗi invocation chỉ xử lý 10.000 block.
- GET phục vụ người dùng chờ `sync()` nếu dữ liệu quá tuổi; read và công việc catch-up đang gắn nhau.
- Cron legacy trong vercel.json một lần/ngày. Chưa xác minh gói Vercel, lịch sử cron hay tốc độ RPC thực tế.
- Dữ liệu lưu một Blob path ghi đè. `inFlight` chỉ khóa trong một process. Chưa thấy distributed lease/conditional write trong adapter hiện tại.
- Có dedupe swap bằng tx/log index; chưa thấy checkpoint block hash/rewind reorg trong đoạn index đã rà.
- Adapter có `behind`, một số màn hình đã có complete/partial. About lấy thống kê trực tiếp từ snapshot mà chưa truyền đầy đủ ngữ cảnh freshness. **Cần mở rộng trạng thái hiện có, không làm lại từ đầu.**

Các nguy cơ concurrent overwrite, mất checkpoint khi process kết thúc và reorg là điểm phải kiểm thử; **chưa chứng minh chúng là nguyên nhân backlog hiện tại**.

### Thiết kế đề xuất

1. Đo trước: thời gian RPC/log range, số block xử lý/giây, last attempted/successful sync, lỗi/throttle, dung lượng snapshot, save latency và các lượt cron thực tế. Tính ETA backfill từ throughput đo được.
2. Tách đọc và đồng bộ. API trả snapshot đã publish nhanh; worker được lập lịch có nhiệm vụ cập nhật. Chưa đổi sang WebSocket chỉ để thay polling; vẫn cần checkpoint và khả năng replay.
3. Backfill lịch sử và theo sát chain có cursor riêng. Không nhảy checkpoint qua vùng chưa đọc rồi gọi index complete. Kết quả partial/live và khoảng lịch sử thiếu phải được đánh dấu tường minh.
4. Một writer có lease, hoặc publish có version/CAS. Blob có thể tiếp tục là snapshot store nếu kiểm chứng được conditional writes với SDK đang cài; đối chiếu tài liệu hiện tại có `ifMatch`, không mặc định version 2.8.2 đã hỗ trợ. Nếu không, chọn store có transaction/lease trước khi cho nhiều worker cùng ghi.
5. Checkpoint sau batch thành công, có snapshot trước để rollback; ghi đè thất bại không làm cursor tiến giả. Replay không nhân đôi swaps/referrals/creators.
6. Chốt safe head/reorg policy sau khi xác minh RPC hỗ trợ `safe`/`finalized`. Giữ block hash, có rewind/replay hoặc cơ chế rebuild tương ứng. Không gọi vài block confirmation là finalized nếu chưa có cơ sở.
7. Chọn tần suất worker sau khi xác minh hosting: legacy Cron Hobby giới hạn một lần/ngày; Pro cho phép mỗi phút theo tài liệu hiện tại. Nếu gói hiện tại không đáp ứng, trình bày lựa chọn chi phí/scheduler trước, không viết cron không deploy được.
8. Production rollout: tạo checkpoint mới theo phiên bản, chạy đối chiếu shadow, so events/receipt tại các mốc; chỉ chuyển reader khi đạt tiêu chí. Giữ rollback snapshot, không xóa index cũ để “bắt đầu lại” tùy tiện.

### Tiêu chí nghiệm thu đề xuất

- Backfill hoàn tất hoặc mọi vùng chưa có dữ liệu được công bố; đối chiếu sampled launches/swaps với RPC độc lập, không chỉ so hai bản copy index.
- Checkpoint không lùi khi có hai process, retry, restart hoặc lỗi save. Dedupe và reorg replay được kiểm thử.
- Sau catch-up: mục tiêu lag dưới 2 phút cho ít nhất 95% mẫu trong 24 giờ, dưới tải/RPC đủ đáp ứng; đây là SLO đề xuất cần đo, không phải cam kết hiện tại. `as_of` lấy block time thực, không chỉ đổi block sang phút bằng hằng số.
- API đọc snapshot có mục tiêu p95 dưới 1 giây khi snapshot đã có; đo trên môi trường preview riêng.
- Coins, token page, leaderboard và About thống nhất trạng thái fresh/partial/stale/unavailable. “0 trades” chỉ khi đã index đủ khoảng thời gian đó.

## 5. Người dùng còn cần gì?

Các nhu cầu dưới đây là giả thuyết rút từ luồng ứng dụng, chưa phải kết quả phỏng vấn người dùng.

| Thời điểm | Câu hỏi của người dùng | Thay đổi đề xuất |
| --- | --- | --- |
| Lần đầu vào | Tôi làm gì ở đây? | Read Me ngắn, 3 việc rõ: check a stock / build a basket / watch a loan. Giữ desktop và mở đúng cửa sổ, không thêm lớp onboarding bắt buộc |
| Tìm cổ phiếu | Đây có đúng token không? Có mua được không? | Search ticker/name/address; xác minh chain+contract; phân biệt verified listing, chưa quan sát và có route thực thi |
| Xem giá | Giá nào là giá tôi sẽ trả? | DEX price, reference value, thời điểm cập nhật và quote thực thi là các mục riêng. Tín hiệu chưa đủ mẫu nói chưa đủ mẫu |
| Chuẩn bị mua | Với $0.5/$1 tôi nhận gì, phí bao nhiêu? | Preview chính số tiền nhập; tổng phí/impact/minimum received; báo min theo route từng leg, không đặt sàn $1 cho mọi stock |
| Chờ quote | Ứng dụng đứng hay đang làm? | Tiến độ theo leg; nguồn đang rate-limit, lần retry kế tiếp, nút retry có kiểm soát. Không làm mất số tiền/weights đã nhập |
| Ký | Còn bao nhiêu lần xác nhận? | Sau kết nối ví, đọc capability rồi hiển thị ước lượng approve/swap hoặc batch. Không quảng cáo một confirmation cho mọi ví |
| Giao dịch dang dở | Tiền có đi chưa? Có nên bấm lại? | Phân biệt awaiting signature / submitted / pending / confirmed / reverted / unknown. Resume batch hiện có; mở rộng recovery cho sequential flow nếu còn thiếu. Không gửi lại leg chưa rõ receipt |
| Sau mua | Tôi thực sự giữ gì? | Receipt theo transfer thực nhận, số token và share-equivalent, phí, link explorer; không dùng quote để giả làm số nhận thực tế |
| Quay lại | Basket này lệch bao nhiêu? | Saved basket/recipe, snapshot holdings có timestamp, drift, top-up preview. Không đếm trùng holdings khi hai basket cùng có NVDAc |
| Khoản vay | Rủi ro thay đổi gì, cần làm gì? | Collateral Watch mở đúng ví, thời điểm vị thế/oracle, stress scenario. Repay/add collateral chỉ là CTA khi đã có tích hợp hợp lệ; không hứa tự cứu vị thế |
| Lỗi nguồn | Tôi nên đợi hay thử lại? | Lỗi theo nguồn, dữ liệu cuối cùng còn xem được và hành động tiếp theo. Không dùng biểu tượng loading vô hạn |

UI copy tiếp tục lowercase English, ASCII, nhãn kiểu folder. Các giá trị tài chính, ticker, address giữ đúng case. Thông tin RPC/cursor dành cho phần details; người dùng thường chỉ cần biết dữ liệu mới hay cũ và có thể làm gì tiếp theo.

## 6. Thứ tự build Quadra

| Đợt | Kết quả bàn giao | Phụ thuộc | Điều kiện xong |
| --- | --- | --- | --- |
| Q0 / data reliability | Index freshness thống nhất, đo worker, backfill, writer/checkpoint an toàn; xử lý Diary unavailable và Relay 429 có giới hạn | Hosting/RPC/store được xác minh | Đạt nghiệm thu mục 4; trạng thái lỗi có test; gate 100%; không báo tất cả feature đã live chỉ vì tests xanh |
| Q1 / blueagent adapter | `hood-live` Base + scorecard, coverage/freshness normalized, source attribution, cache và failure states | Q0 conventions; schema hiện tại | 12 observed không thành 338 live; null không thành zero; không trộn chain; không có thanh toán ngầm |
| Q2 / stocks health UX | Stock detail dùng dữ liệu Q1 + canonical metadata; CTA tới Basket/Trade/Loan Watch giữ context | Q1 và execution preflight hiện có | Chọn stock một lần, mở đúng contract; giá tham chiếu không thay thế executable quote; thiếu coverage vẫn đọc được danh tính |
| Q3 / basket completion | Xem tổng chi phí, tiến độ/recovery, receipt, saved baskets và drift; cải tiến top-up trước | Q0 quote reliability + Q2 | Test tiny amounts, partial success, reload, account/chain change, quote hết hạn; không double-buy khi unknown |
| Q4 / rebalance preview | Kế hoạch phân bổ trước/sau, lựa chọn add-only hoặc mua/bán; fee/impact/min-trade rõ | Holdings/snapshots/receipts Q3 chính xác | Preview-only trước; người dùng duyệt từng kế hoạch, chưa tự động giao dịch hoặc hứa một confirmation |

Corporate-actions feed và thông báo nằm sau khi có endpoint/schema Blue Agent đã xác minh. Không đưa thành dependency bắt buộc của Q0–Q2. Chưa build vault index, auto-trading, lending contract mới hoặc tích hợp cộng đồng trong plan này.

## 7. Cách kiểm chứng UX trước khi mở rộng

Dùng bản preview để quan sát 5 tác vụ: tìm AAPLc; lập basket $1; xử lý quote 429; quay lại giao dịch pending; tìm mức rủi ro khoản vay. Mỗi tác vụ có kịch bản kỳ vọng, dùng read-only hoặc dữ liệu test khi không cần giao dịch. Khi cần giao dịch thật, người dùng tự ký ví.

Ghi nhận tỷ lệ hoàn thành, thời gian đến preview hợp lệ, số lần mất input, retry, chữ không hiểu, và lần bấm mua lại khi trạng thái chưa rõ. Chưa tự động thu telemetry, địa chỉ ví hoặc gửi dữ liệu sang dịch vụ khác trong đợt nghiên cứu.

Cần xác minh trước build: gói hosting và function limits; quyền đọc log vận hành; RPC throughput/archive; version/capability store; schema/coverage/điều kiện sử dụng Blue Agent; cách chi trả các endpoint paid nếu muốn dùng. Những mục này là đầu việc điều tra, chưa phải lý do yêu cầu chủ dự án tự thiết kế giải pháp.

## Nguồn

- [Blue Agent catalog](https://blueagent.dev/api/catalog) — GET trực tiếp 200; discovery 30 tools, giá và schema. Sample provenance=shape không phải response live.
- [Blue Agent](https://blueagent.dev/) và [Docs](https://blueagent.dev/docs) — ngữ cảnh sản phẩm; số liệu marketing không thay thế dữ liệu endpoint.
- [Tokenized Stocks API](https://docs.base.org/sdks/tokenized-stocks/overview) — metadata, multipliers, NAV, phạm vi wallet/PnL.
- [Vercel Cron limits](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing) — giới hạn theo gói; cần xác minh gói thực tế.
- [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk) — conditional writes/ETag; đối chiếu version trước triển khai.
- Mã Quadra: `src/server/indexer.ts`, `indexStore.ts`, `vercel.ts`, `vercel.json`, `src/adapters/http/indexer.ts`, `src/features/panels/BasketPanel.tsx`, `useBasketBatch.ts`, `TxSteps.tsx`, `CoinsPanel.tsx`, `LeaderboardPanel.tsx`, `src/pages/About.tsx`.
