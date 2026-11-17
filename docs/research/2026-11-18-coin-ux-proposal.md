# Đề xuất trải nghiệm Quadra / coin workspace

Ngày 18/11/2026. Phạm vi: nghiên cứu và đề xuất, chưa thay code sản phẩm trong lượt này.

## Cơ sở quan sát

Đã đọc các trang Stax bên dưới. Trình duyệt kiểm tra trực tiếp bố cục Baskets, Create, Earn và trạng thái chưa kết nối Arena; các trang còn lại đọc nội dung công khai. Không kết nối ví, không kiểm chứng giao dịch hoặc số liệu tài chính của Stax. Một số nội dung web được bộ máy tìm kiếm lưu từ các ngày khác nhau; không coi placeholder là số liệu thật.

| Trang | Điều quan sát được | Áp dụng cho Quadra |
| --- | --- | --- |
| [Home](https://stax.finance/) | Thông điệp sản phẩm và hành động chính rõ | Một câu giải thích từng ứng dụng ngay khi mở folder |
| [Baskets](https://stax.finance/baskets) | Thành phần, tỷ trọng, preview và CTA | Xem trước recipe; chọn rõ ràng bằng click và bàn phím, không phụ thuộc hover |
| [Mint](https://stax.finance/mint) | Số tiền trả, lượng nhận, phí, chi phí ước tính | Review đầy đủ chi phí và kết quả trước khi mở ví |
| [Trade](https://stax.finance/trade) | Search, nhóm tài sản, hướng dẫn các bước | Giữ tài sản đang chọn xuyên suốt luồng giao dịch; Quadra vẫn spot |
| [Create](https://stax.finance/create) | Chọn ticker, phân bổ, preview cạnh form | Launch theo bước; basket editor có thanh tỷ trọng và split evenly |
| [Earn](https://stax.finance/stake) | Mô tả tác động trước/sau và điều kiện nhận thưởng | Fee/reward chỉ hiện trong ngữ cảnh coin liên quan, giải thích điều kiện |
| [Portfolio](https://stax.finance/portfolio) | Chưa kết nối: giải thích dữ liệu sẽ xuất hiện | Holdings và receipts là đích đến sau giao dịch, không chỉ nút connect |
| [Leaderboard](https://stax.finance/leaderboard) | Chỉ rõ cách xếp hạng, có kỳ đo | Chỉ xếp hạng trên dữ liệu đủ; ghi coverage và kỳ đo |
| [Gacha](https://stax.finance/gacha) | Công bố việc trả tiền trước lượt rút | Không đưa cơ chế trả tiền ngẫu nhiên vào luồng mua coin |
| [Arena](https://stax.finance/arena) | Trang riêng, cần ví; docs đánh dấu preview | Các trải nghiệm vui để ở folder phụ; không cản giao dịch |
| [Docs](https://stax.finance/docs) | Mục lục theo cơ chế, phí, rủi ro, FAQ | Trợ giúp ngay tại field, docs sâu qua link theo ngữ cảnh |

Stax mô tả basket token mint/redeem trên Robinhood Chain. Quadra mua từng tài sản vào ví trên Base. Không dùng nhãn mint, redeem hoặc lời hứa một transaction cho basket Quadra. Cách Trade Stax cấp trading key cũng không chứng minh mọi ví Quadra ký một lần.

## Những điểm cần sửa trong Coins hiện tại

Đối chiếu localhost `?do=coins` và `CoinsPanel.tsx`, `TokenPage.tsx`:

1. Hai đoạn giới thiệu cộng hero, bốn ô thống kê và sáu nút sort chiếm vùng đầu trước danh sách. CTA mạnh nhất là Launch dù mục đích chính của màn này là khám phá.
2. Bộ lọc `Stocks` thực chất chọn coin có quote khác ETH. Tên này dễ bị hiểu là stock token. Đổi thành `stock-paired`, nhóm ETH thành `eth-paired`; nhận diện stock phải dựa registry/identity được xác minh, không mặc định mọi quote khác ETH là stock.
3. Dòng coin trộn tên, CA, verdict, pair, market cap, fee, volume, số trade, tuổi và creator trong prose; khó so sánh.
4. Detail đã có buy/sell, chart, pair exposure, fees, holders và verdict. Cần tổ chức lại các thành phần có sẵn; không tạo thêm một trang Trade trùng cho coin launchpad.
5. `market === null` đang dẫn tới nhãn `not traded yet`; thiếu dữ liệu từ nhà cung cấp không chứng minh chưa từng giao dịch. Chỉ ghi `no trades yet` nếu lịch sử đúng pool được đọc đầy đủ.
6. Stats và dòng coin có nhánh cộng volume thiếu thành 0. Phải giữ unknown/partial, không tô đẹp số liệu bằng fallback zero.

## Điều hướng và ngôn ngữ

Giữ desktop full-width, folder và cửa sổ Macintosh; không đưa lại applications panel luôn hiện.
Các cửa chính: `coins`, `stocks`, `baskets`, `portfolio`, `launch`. Check/terminal/agents và các công cụ sâu vẫn truy cập được qua folder/menu hiện có. Đổi nhãn Wallet sang Portfolio cần giữ route cũ và chức năng wallet settings.

- `coins`: `discover coins launched on quadra.`
- `stocks`: `explore stock tokens on base.`
- `baskets`: `choose a mix. hold each asset in your wallet.`
- `portfolio`: `your assets and recent activity.`
- Pair: `paired with AAPLc` và `this coin is not Apple stock. AAPLc is its trading pair.`

Tickers và địa chỉ giữ nguyên case. Không dùng nhãn backed by, stock ownership hoặc safe chỉ vì có stock pair/contract fixed supply. Dữ liệu Blue Agent bổ sung ngữ cảnh stock; không thay quote, simulation hoặc receipt.

## Ba luồng chính

### Khám phá và mua coin

`coins / discover` -> chọn coin -> `overview` -> nhập số tiền -> `review trade` -> xác nhận trong ví -> receipt -> `view holdings`.

Danh sách: search nổi bật; filter `all / stock-paired / eth-paired`; một sort dropdown; watchlist local; table desktop và card mobile. Cột mặc định: coin, pair, price, 24h change, liquidity. Tuổi/volume/creator ở secondary detail. Chỉ vẽ sparkline khi có lịch sử thật.

Quay lại giữ search, filter, sort, scroll. Deep link đến coin không cần đi qua desktop hoặc intro. Không yêu cầu kết nối ví để browse/check.

Detail: header tên/icon/CA/Base; trái chart và dữ liệu, phải ticket mua/bán. Tabs `overview / activity / holders / fees`. Check summary và điều kiện chuyển token nằm gần review; báo cáo kỹ thuật mở rộng. Trade vẫn qua pool riêng của coin, không tự đổi sang Relay.

Ticket: you pay, you receive estimate, balance, minimum received, price impact, fee, estimated gas, quote time/expiry, trạng thái số lần xác nhận khi xác định được. Không mặc định có USDC route cho mọi coin. Nếu cần đổi ETH sang quote stock, giải thích các bước và giữ ranh giới ký hiện tại.

Receipt phân biệt confirmed, reverted, pending, unknown. Hiện số lượng thực nhận khi đo được, explorer và refresh holdings. Không gửi lại giao dịch khi chưa rõ kết quả.

### Launch coin

`launch / identity` -> `pair` -> `fees and allocation` -> `review` -> wallet -> coin page.

Preview bên cạnh thay đổi theo form. Giải thích stock pair ở bước chọn pair, phí mở đầu nếu có ở review. Lưu draft theo phiên/account phù hợp; đổi account/chain làm vô hiệu quote và simulation. Hoàn tất dẫn tới coin vừa launch, không trả về form trắng.

### Basket

`baskets / discover` -> preview recipe -> `use this allocation` -> nhập budget -> review từng leg -> wallet -> receipts và holdings.

Kế thừa BasketLibrary và recovery đang có. Phân biệt target weights, phân bổ khoản mua mới, actual holdings. Không tạo basket token giả hoặc cộng holdings của recipe chồng nhau hai lần. PnL chỉ khi có cost basis đáng tin; còn lại ghi `cost basis unavailable`.

## Visual và responsive

- Cobalt cho selected/CTA, giấy ấm cho workspace, đen cho chữ. Viền Platinum ở khung, không đóng khung mọi câu.
- Pixel folder/icon cho điều hướng; logo coin thật hoặc fallback initials. Không dùng logo Apple như logo của coin ghép AAPLc.
- Chữ body 14-16px, số tabular, heading 24-32px trong workspace. Monospace cho metadata/địa chỉ; không biến cả đoạn giải thích thành terminal.
- Desktop 2K: cửa sổ mở rộng được, sử dụng phần lớn vùng làm việc; chart co giãn, ticket khoảng 360-400px, sidebar khoảng 200px. Không kéo prose qua cả 2560px; full-width workspace khác với dòng chữ full-width.
- Desktop nhỏ: bỏ sidebar phụ, giữ chart/ticket khi đủ rộng. Mobile: một cột, chuyển overview/trade rõ ràng, action ở vùng nhìn thấy; không che input hoặc receipt.
- Không glow/scanline/animation chạy trên form tiền. 3D intro tùy chọn, không lặp khi mở deep link. Respect reduced motion.
- Loading có skeleton đúng vị trí và trạng thái; timeout thành retry. Unknown khác 0; stale khác live. Không thay dữ liệu thật bằng demo trong sản phẩm.

## Thứ tự build và nghiệm thu

1. **Coins discover**: nhãn đúng, bớt phần đầu, table/card, trạng thái unknown, filter/sort trong URL và phục hồi back. Tận dụng API hiện có; freshness cần worker/index đáng tin trước khi quảng bá ranking live.
2. **Coin detail + review**: hai cột, gom tab, ticket rõ ràng, receipt và holdings handoff. Giữ simulation, route và signing guard hiện tại.
3. **Launch wizard**: preview, draft, review và success link. Không đổi economics/contract trong đợt UX.
4. **Stocks/baskets/portfolio kết nối**: cùng asset identity, Blue Agent freshness, recipe/holdings rõ, history và receipt archive.
5. **Retention nhẹ**: watchlist, recent assets, saved recipe và share card từ kết quả thật. Leaderboard sau khi dữ liệu đủ; game không nằm trong critical path.

Nghiệm thu: người mới xác định đúng coin vs stock token vs basket; mở coin từ tìm kiếm và quay lại không mất trạng thái; tìm được phí và minimum received trước ký; lỗi có bước tiếp theo; CTA không bị khuất tại 390/768/1440/2560 CSS px; keyboard/focus và contrast đúng; không gửi tx khi preview; account/chain change vô hiệu review cũ. Chạy gate 100% và kiểm tra browser sau implementation. Đo completion/time-to-quote bằng usability task trước; không thêm analytics gửi địa chỉ ví mặc định.

Ưu tiên đề xuất: build liền mạch **Coins discover + Coin detail** trước, thay vì bổ sung thêm nhiều cửa sổ. Báo cáo này chưa triển khai thay đổi, chưa commit/push/deploy.

## Bổ sung o1 Launchpad / hành trình creator

Ngày 18/11/2026: xem trực tiếp [dashboard](https://launch.o1.exchange/), [form launch](https://launch.o1.exchange/token/create), chuyển Tax token sang Standard token, mở bộ chọn paired asset và mở Profile. Không kết nối ví hoặc submit; chỉ quan sát UI. Profile chưa kết nối giới thiệu launches, fee claims, vesting và wallet assets; chưa xác minh màn sau đăng nhập. Số liệu/nhãn o1 là dữ liệu hiển thị của website, chưa kiểm toán contract hoặc nguồn giá.

### Điều học được

- Form có khối nhận diện, lựa chọn launch và live preview đặt cạnh nhau. Preview cho thấy tên, ticker/pair, giá khởi đầu, vốn hóa khởi đầu và supply; tạo cảm giác đang chuẩn bị một sản phẩm cụ thể.
- Pair picker có search, category, giá, thanh khoản và các trạng thái riêng. Quan sát thấy `Launch enabled` cùng xuất hiện với `Low liquidity`, `No token supply` hoặc `Liquidity unavailable`: quyền tạo cặp không đồng nghĩa khả năng khớp giao dịch.
- Dashboard có search theo tên/symbol/address và lựa chọn grid/card/table. Quadra có thể giữ table desktop/card mobile trước; không cần thêm mọi chế độ ngay.
- Profile là điểm quay lại của creator sau launch. Đây là phần nên bổ sung vào kế hoạch Quadra: tạo coin, mở trang coin, theo dõi và nhận phí là một hành trình.

### Luồng creator đề xuất cho Quadra

`launch / identity` -> `launch / pair` -> `launch / options` -> `launch / review` -> wallet -> `coin / overview` -> `creator / my launches`.

1. **Identity:** tên, ticker, mô tả, logo và links theo schema hiện có. Preview dùng chung component với Coins để hình xem trước và trang thực thống nhất. Đánh dấu `draft`; không vẽ giá/volume/holder giả.
2. **Pair:** search các pair thật sự được factory Quadra bật; nhóm ETH và stock tokens có identity xác minh. Hiện địa chỉ, đơn vị, availability, data timestamp và liquidity context nếu có. Nói rõ liquidity của quote token khác liquidity của pool coin sắp tạo. Blue Agent chỉ cung cấp dữ liệu tham khảo; factory và chain quyết định pair được phép, simulation quyết định khả năng thực thi.
3. **Options:** phí giao dịch trong các lựa chọn contract đang hỗ trợ, first buy tùy chọn, thông tin opening protection đọc từ contract. First buy mặc định tắt, không tự chọn số tiền. Phân biệt creation cost, gas, tiền first buy và fee thu trên giao dịch sau này.
4. **Review:** hiển thị pair, supply, giá/vốn hóa mở đầu dưới dạng estimate, fee split và recipient, first buy, tổng khoản chi đã biết, địa chỉ dự đoán và các thiết lập không đổi được sau launch. Nêu số bước ví theo trường hợp thật; stock first buy có thể cần approve rồi launch. Mọi chỉnh sửa/account/chain change vô hiệu review cũ.
5. **Pending/success:** phân biệt chờ ví, gửi tx, chờ chain, confirmed nhưng index chưa thấy coin. Dùng receipt làm bằng chứng launch, không coi index chậm là thất bại; không khuyến khích launch lại. Thành công có `open coin`, `copy link`, `view transaction`, `my launches`.
6. **Creator workspace:** tab `my launches` trong portfolio/creator view dùng dữ liệu hiện có. Từng coin có pair, ngày launch, trạng thái dữ liệu, phí có thể nhận theo từng currency, đã nhận nếu lịch sử đủ, `collect fees`, `open coin`, `share`. Draft lưu local phải ghi rõ `saved on this device`. Không hiển thị quyền sửa mint/pool/fee nếu contract không hỗ trợ.

### Visual

Cửa sổ `launch / new coin` rộng, bên trái form theo bước, bên phải preview cố định trong vùng cuộn hợp lý. Thanh bước dùng `identity / pair / options / review`, nút `back` và `continue`, nút cuối `launch coin` chỉ ở review. Mobile đưa preview thành mục mở xem và luôn giữ summary chi phí trước nút cuối. Giữ viền Platinum, folder/icon và cobalt của Quadra; không sao chép dark dashboard của o1.

### Giới hạn và thứ tự cập nhật

Đây là tham khảo UX, không đưa integration o1 đã archive trở lại. Không tự thêm tax token, chia phí qua tài khoản X, vesting, editable metadata, vanity address hoặc multichain: chúng cần kiểm tra contract/phạm vi riêng. Quadra dùng factory của mình và giữ các ràng buộc đã có.

Thứ tự đề xuất cập nhật: **Coins discover -> Coin detail/review -> Launch wizard + success -> Creator workspace -> Basket/Portfolio liên thông**. Creator workspace gom lại launches/collect hiện có trước, không xây một hệ thống rewards mới.

Nghiệm thu bổ sung: pair disabled trong lúc review phải chặn launch; unknown liquidity không biến thành zero hoặc available; preview không gọi ví; refresh khi pending không tạo coin trùng; receipt confirmed/index lag vẫn mở được coin theo địa chỉ; fee recipient và split đúng dữ liệu contract; creator đổi ví không nhìn nhầm fees/draft của ví trước.

## Read Me và marketing / triển khai bước đầu

Read Me nay mở trong window manager hiện có, giữ các form phía sau. Welcome mở cùng cửa sổ này; `/about` cũ chuyển về `/?do=readme`. Trang giới thiệu hiện có được chuyển sang `/marketing`, mở bằng link rõ ràng trong tab mới từ Read Me.

Đề xuất marketing tiếp theo: hero `your desktop for coins and stocks on base.` với CTA `open quadra`; ba câu chuyện `discover coins / build a basket / launch a coin`; mỗi câu chuyện có ảnh sản phẩm thật và link mở đúng cửa sổ. Tiếp theo là minh họa coin khác stock token và basket, flow review/wallet/receipt, giới hạn dữ liệu và FAQ. Đưa fee flow sâu xuống dưới, bỏ việc dùng token nền tảng làm thông điệp đầu. Không yêu cầu connect để đọc marketing. Nội dung lowercase English, giữ tickers/addresses; không hứa one confirmation cho mọi ví.

Coins bước đầu: bỏ lede trùng, search gần đầu, nhãn eth-paired/stock-paired, sort dropdown ASCII, thống kê chuyển vào disclosure; dữ liệu market chưa tìm thấy không còn gọi là chưa từng giao dịch. Coin detail, wizard launch và creator workspace vẫn cần triển khai tiếp; chưa coi toàn bộ proposal đã hoàn tất.

### Điều chỉnh URL theo chủ dự án

Chủ dự án làm rõ: landing page giới thiệu dự án dùng `/about`, không dùng tên `/marketing`. Read Me vẫn mở bằng `?do=readme` trong desktop để giữ các form. Link product tour từ Read Me mở `/about` ở tab mới. Điều chỉnh này thay thế quyết định URL `/marketing` phía trên; hướng thiết kế landing page riêng vẫn giữ.
