# contracts/deployed — exact sources of what is on chain

`LaunchFactory.v1.sol` is the source deployed by the owner on 2026-10-02 at
`0xcDb2eC1c487fbcB6B4AF25cCD86aFf8120FaB8a5` (ETH pairs only; the first real launch and fee
collection went through it). Kept byte-for-byte so the deployed bytecode can always be matched
against it; not compiled (outside `src/`). Its tokens keep working forever — anyone can `collect`
their fees from it. New launches go through `src/LaunchFactory.sol` (v2, ETH or stock pairs),
deployed by the owner 2026-10-02 at `0xef1F427bB57e0ECd7BB8051cE8bC7AAb709a0c03`.
