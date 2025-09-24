(define-constant ERR-INSUFFICIENT-BALANCE u100)
(define-constant ERR-NOT-AUTHORIZED u101)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-INVALID-PROGRAM u103)
(define-constant ERR-INVALID-RECEIVER u104)
(define-constant ERR-TRANSFER-LOCKED u105)
(define-constant ERR-INVALID-TIMESTAMP u106)
(define-constant ERR-INVALID-METADATA u107)
(define-constant ERR-TRANSFER-LIMIT-EXCEEDED u108)
(define-constant ERR-INVALID-FEE u109)

(define-data-var transfer-fee uint u100)
(define-data-var max-transfer-limit uint u1000000)
(define-data-var fee-recipient principal tx-sender)
(define-data-var transfer-lock bool false)
(define-data-var min-transfer-amount uint u10)

(define-map point-balances
  { user: principal, program-id: uint }
  { balance: uint })

(define-map transfer-history
  { transfer-id: uint }
  { sender: principal, receiver: principal, program-id: uint, amount: uint, timestamp: uint, metadata: (string-utf8 100) })

(define-map program-registry
  { program-id: uint }
  { is-active: bool, owner: principal })

(define-data-var transfer-counter uint u0)

(define-read-only (get-balance (user principal) (program-id uint))
  (default-to u0 (get balance (map-get? point-balances { user: user, program-id: program-id }))))

(define-read-only (get-transfer-details (transfer-id uint))
  (map-get? transfer-history { transfer-id: transfer-id }))

(define-read-only (get-program-status (program-id uint))
  (map-get? program-registry { program-id: program-id }))

(define-read-only (get-transfer-fee)
  (var-get transfer-fee))

(define-read-only (get-max-transfer-limit)
  (var-get max-transfer-limit))

(define-read-only (get-fee-recipient)
  (var-get fee-recipient))

(define-read-only (is-transfer-locked)
  (var-get transfer-lock))

(define-private (validate-amount (amount uint))
  (if (and (>= amount (var-get min-transfer-amount)) (<= amount (var-get max-transfer-limit)))
      (ok true)
      (err ERR-INVALID-AMOUNT)))

(define-private (validate-receiver (receiver principal))
  (if (not (is-eq receiver 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-INVALID-RECEIVER)))

(define-private (validate-program (program-id uint))
  (match (map-get? program-registry { program-id: program-id })
    program
    (if (get is-active program)
        (ok true)
        (err ERR-INVALID-PROGRAM))
    (err ERR-INVALID-PROGRAM)))

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP)))

(define-private (validate-metadata (metadata (string-utf8 100)))
  (if (<= (len metadata) u100)
      (ok true)
      (err ERR-INVALID-METADATA)))

(define-public (set-transfer-fee (new-fee uint))
  (begin
    (asserts! (is-eq tx-sender (var-get fee-recipient)) (err ERR-NOT-AUTHORIZED))
    (asserts! (> new-fee u0) (err ERR-INVALID-FEE))
    (var-set transfer-fee new-fee)
    (ok true)))

(define-public (set-max-transfer-limit (new-limit uint))
  (begin
    (asserts! (is-eq tx-sender (var-get fee-recipient)) (err ERR-NOT-AUTHORIZED))
    (asserts! (> new-limit u0) (err ERR-INVALID-AMOUNT))
    (var-set max-transfer-limit new-limit)
    (ok true)))

(define-public (set-fee-recipient (new-recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get fee-recipient)) (err ERR-NOT-AUTHORIZED))
    (try! (validate-receiver new-recipient))
    (var-set fee-recipient new-recipient)
    (ok true)))

(define-public (toggle-transfer-lock (lock bool))
  (begin
    (asserts! (is-eq tx-sender (var-get fee-recipient)) (err ERR-NOT-AUTHORIZED))
    (var-set transfer-lock lock)
    (ok true)))

(define-public (transfer-points (receiver principal) (program-id uint) (amount uint) (metadata (string-utf8 100)))
  (let ((sender-balance (get-balance tx-sender program-id))
        (transfer-id (var-get transfer-counter)))
    (begin
      (asserts! (not (var-get transfer-lock)) (err ERR-TRANSFER-LOCKED))
      (try! (validate-amount amount))
      (try! (validate-receiver receiver))
      (try! (validate-program program-id))
      (try! (validate-metadata metadata))
      (asserts! (>= sender-balance amount) (err ERR-INSUFFICIENT-BALANCE))
      (try! (stx-transfer? (var-get transfer-fee) tx-sender (var-get fee-recipient)))
      (map-set point-balances { user: tx-sender, program-id: program-id }
        { balance: (- sender-balance amount) })
      (map-set point-balances { user: receiver, program-id: program-id }
        { balance: (+ (default-to u0 (get balance (map-get? point-balances { user: receiver, program-id: program-id }))) amount) })
      (map-set transfer-history { transfer-id: transfer-id }
        { sender: tx-sender, receiver: receiver, program-id: program-id, amount: amount, timestamp: block-height, metadata: metadata })
      (var-set transfer-counter (+ transfer-id u1))
      (print { event: "transfer-points", id: transfer-id })
      (ok transfer-id))))