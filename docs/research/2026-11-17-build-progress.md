# Tiến độ triển khai Q0–Q4

Chỉ local, chưa commit/push/deploy. Gate cuối: 2373 tests trong 138 files; coverage 100% cả bốn chỉ số; build thành công.

Đã triển khai:
- Blob snapshot có conditional write theo ETag; lần tạo mới không overwrite. Không có ETag thì từ chối lưu. Save thất bại phục hồi state trước lượt sync.
- Production reader được tách khỏi worker: đọc snapshot đã lưu và kiểm tra head, không scan lịch sử trong request của người dùng. Cron dùng handler sync riêng. Chưa triển khai thay đổi này lên production.
- Thông báo partial/freshness ở Coins, About và lịch sử giao dịch token. Unknown/error không được coi là caught-up.
- Endpoint miễn phí Blue Agent `hood-live` được gọi qua đường same-origin Base-only và cache 30 giây. Stock health trong Trade hiển thị identity, multiplier, coverage, thời gian dataset/oracle, gap và thanh khoản. Không dùng làm executable quote hay giấy phép transfer.
- Basket có rebalance preview add-only hoặc buy/sell, số tiền tính bằng bigint, drift và ngưỡng dust. Preview không ký hoặc tạo giao dịch.
- Luồng basket sequential có journal trước ranh giới gửi ví. Pending hash được giữ qua reload; timeout/response không rõ/corrupt storage khóa mua lại. Chỉ receipt đúng hash mới gỡ khóa; từ chối ví 4001 được giải phóng. Khi confirmed sau reload, yêu cầu refresh holdings và review phần phân bổ còn lại, không tự gửi lại.
- Test hồi quy basket xác nhận partial resume, batch pending, known/unknown recovery, data failures và phép tính preview.

Chưa đạt toàn bộ plan, không nên gọi Q0–Q4 hoàn tất:
- Chưa backfill backlog production; chưa xác minh hosting plan, cron frequency/RPC throughput và SLO 24 giờ. Reader mới không được rollout riêng trước khi worker có tần suất đáp ứng.
- Chưa có safe-head/block-hash reorg replay và cursor tách live/history; worker đã được nâng cấp lưu checkpoint sau mỗi batch bounded sync ngày 18/11. Cần hoàn tất trước khi tuyên bố index reliability hoàn chỉnh.
- Chưa chuẩn hóa adapter scorecard chung, circuit breaker/coalescing mọi nguồn hoặc nhận diện 429 xuyên toàn bộ quote engine. Basket giữ retry giới hạn hiện có.
- Chưa tích hợp stock health context vào toàn bộ Markets/Loan Watch; hiện nằm ở stock đã chọn trong Trade.
- Chưa thêm timestamp snapshot holdings/receipt archive/share-equivalent cho mọi leg hoặc tự phục hồi toàn bộ recipe sau reload. Journal hiện bảo vệ chống gửi lại; không phải resume execution tự động.
- Chưa chạy giao dịch thật bằng ví người dùng; không chứng minh mọi route đang giao dịch được.

Ưu tiên tiếp: worker/checkpoint/reorg + công cụ backfill và đo throughput; sau đó Q1/Q2 adapter/context và hoàn thiện Q3 receipts/draft recovery. Giữ gate 100% và kiểm tra localhost cho từng thay đổi.

Cập nhật 18/11: xem `2026-11-18-stax-and-basket-build.md`. Gate mới 2374/138, 100%; đã thêm basket library preview/apply và checkpoint từng batch.
