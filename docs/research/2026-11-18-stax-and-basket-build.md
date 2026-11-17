# Stax và phần build tiếp cho Quadra

Ngày: 18/11/2026. Đã đọc homepage, /trade, /mint và /baskets của Stax. Đây là đối chiếu giao diện và nội dung website, chưa kiểm toán contract hoặc thực hiện giao dịch trên Stax.

## Điều rút ra

- [Homepage](https://stax.finance/) và [Baskets](https://stax.finance/baskets): hành trình chọn danh mục, xem thành phần và mở thao tác được phân biệt rõ. Có thể học cách giúp người dùng hiểu họ sắp mua gì trước khi nhập tiền.
- [Mint](https://stax.finance/mint): mô tả phí giao thức, lượng nhận dự kiến và chi phí hai chiều. Quadra chỉ nên hiển thị các con số tương ứng khi có quote/receipt đúng phạm vi, không lấy phí hoặc estimate của Stax để áp vào Base.
- [Trade](https://stax.finance/trade): website mô tả giao dịch đòn bẩy qua Lighter trên Robinhood Chain và bước cấp quyền giao dịch. Đây không phải cùng mô hình ký swap spot vào ví của Quadra; không thể dùng mô tả một chữ ký đó để hứa mọi ví chỉ xác nhận một lần.
- Stax mô tả mint/redeem một basket token trên Robinhood Chain. Quadra hiện mua tài sản riêng vào ví Base; recipe chia sẻ không phải ERC-20 hay vault có quyền redemption.
- Một số giá trị trên trang đọc được là placeholder/loading; không dùng chúng làm số liệu thanh khoản hay hiệu năng đã đo.

## Đã build trong lượt này

1. `BasketLibrary`: mục `baskets / explore` ngay trong Treasury Basket. Chọn preset để xem số tài sản, tỷ trọng và biểu đồ meter. Chỉ nút `use this allocation` mới thay editor; không gọi quote hoặc ví khi preview. Giữ bộ preset đã có, không sao chép danh mục Robinhood sang Base khi chưa xác minh tài sản.
2. Bỏ thanh preset tức thì bị trùng, giữ editor tùy chỉnh, saved recipes và share link hiện có.
3. Worker index lưu snapshot sau mỗi batch bounded sync; đọc lại version storage trước batch tiếp theo. Nếu worker khác đã tiến xa hơn, adopt checkpoint đó. Save thất bại phục hồi state trước batch, không publish tiến độ chưa lưu. ETag conditional writes tiếp tục bảo vệ xung đột.
4. Kiểm thử thêm nhánh concurrent checkpoint và kiểm tra preview không thay editor trước khi áp dụng.

## Xác minh

- Gate: 2374 tests / 138 files, coverage 100% statements/branches/functions/lines; production build thành công. API bundles đã tái sinh.
- Browser localhost: preview AI compute giữ Asset 1=AAPL; sau Apply đổi NVDA 40%, MSFT/GOOGL/META 20% và đúng share link.
- Không ký giao dịch, không backfill production, chưa commit/push/deploy.

## Còn phải hoàn thiện trong plan tổng

Safe-head/reorg replay, công cụ backfill/đo worker và lịch chạy phù hợp hosting; receipt archive/share-equivalent và phục hồi draft đầy đủ; adapter context giữa Markets/Trade/Loan Watch. Chưa coi Q0–Q4 hoàn tất. Trước rollout reader mới cần worker đủ tần suất, chạy backfill và chứng minh freshness; không chuyển production chỉ vì gate đã xanh.
