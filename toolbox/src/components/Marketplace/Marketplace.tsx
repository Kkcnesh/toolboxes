import { useState } from "react";
import { useToolStore } from "../../store/useToolStore";
import { LISTINGS, Listing } from "../../demo/market";
import { Button } from "../shared/Button";

function priceLabel(listing: Listing): string {
  if (listing.premium) return "Premium";
  return listing.price > 0 ? `$${listing.price}` : "Free";
}

function ToolCard({
  listing,
  onShare,
  onPaywall,
}: {
  listing: Listing;
  onShare: (listing: Listing) => void;
  onPaywall: () => void;
}) {
  const owned = useToolStore((s) => s.qrOwned.includes(listing.id));
  const premium = useToolStore((s) => s.qrPremium);
  const buy = useToolStore((s) => s.qrBuyTool);
  const toast = useToolStore((s) => s.qrShowToast);

  const locked = listing.premium && !premium;

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="flex items-start justify-between">
        <span className="h-9 w-9 rounded-lg" style={{ background: listing.color }} />
        <span
          className="rounded-full border px-2 py-0.5 text-[10.5px]"
          style={{
            borderColor: locked ? "var(--color-amber)" : "var(--color-border)",
            color: locked ? "var(--color-amber)" : "var(--color-text-muted)",
          }}
        >
          {owned ? "Owned" : priceLabel(listing)}
        </span>
      </div>
      <div className="text-[13.5px] font-medium">{listing.name}</div>
      <div className="text-[11.5px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
        {listing.description}
      </div>
      <div className="text-[10.5px]" style={{ color: "var(--color-text-faint)" }}>
        by @{listing.author} · ★ {listing.rating} · {listing.installs} installs
      </div>
      <div className="mt-2 flex items-center gap-2">
        {owned ? (
          <Button
            variant="secondary"
            onClick={() => toast("This is a demo listing — running it isn't enabled here.")}
          >
            Open
          </Button>
        ) : locked ? (
          <Button variant="primary" onClick={onPaywall}>
            Unlock
          </Button>
        ) : (
          <Button variant="primary" onClick={() => buy(listing.id)}>
            {listing.price > 0 ? `Buy $${listing.price}` : "Get"}
          </Button>
        )}
        <button onClick={() => onShare(listing)} className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
          Share
        </button>
      </div>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.28)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[420px] flex-col gap-3 rounded-xl border p-5"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        {children}
      </div>
    </div>
  );
}

export function Marketplace() {
  const tab = useToolStore((s) => s.qrMarketTab);
  const setTab = useToolStore((s) => s.setMarketTab);
  const premium = useToolStore((s) => s.qrPremium);
  const myListings = useToolStore((s) => s.qrMyListings);
  const incoming = useToolStore((s) => s.qrIncoming);
  const outgoing = useToolStore((s) => s.qrOutgoing);
  const accept = useToolStore((s) => s.qrAcceptShare);
  const decline = useToolStore((s) => s.qrDeclineShare);
  const publish = useToolStore((s) => s.qrPublishListing);
  const share = useToolStore((s) => s.qrShareTool);
  const activate = useToolStore((s) => s.qrActivatePremium);
  const redeem = useToolStore((s) => s.qrRedeemCode);
  const closeMarket = useToolStore((s) => s.closeMarket);

  const [publishOpen, setPublishOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<Listing | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("0");
  const [proOnly, setProOnly] = useState(false);
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  const pending = incoming.filter((item) => item.status === "pending").length;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-start justify-between border-b px-6 py-5" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-3">
          <button
            onClick={closeMarket}
            title="Back"
            className="rounded px-1.5 py-0.5 text-[14px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            ←
          </button>
          <div>
            <div className="text-[17px] font-medium">Marketplace</div>
            <div className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
              Buy, sell and share tools built by the community.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {premium ? (
            <span
              className="rounded-full border px-2.5 py-1 text-[11px]"
              style={{ borderColor: "var(--color-green)", color: "var(--color-green)" }}
            >
              Premium
            </span>
          ) : (
            <Button variant="secondary" onClick={() => setPaywallOpen(true)}>
              Go Premium
            </Button>
          )}
          <Button variant="secondary" onClick={() => setRedeemOpen(true)}>
            Redeem code
          </Button>
          <Button variant="primary" onClick={() => setPublishOpen(true)}>
            Publish
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b px-6" style={{ borderColor: "var(--color-border)" }}>
        {[
          ["browse", "Browse"],
          ["shared", `Shared with me${pending ? ` (${pending})` : ""}`],
          ["mine", "My listings"],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value as "browse" | "shared" | "mine")}
            className="border-b-2 px-3 py-2.5 text-[12.5px]"
            style={{
              borderColor: tab === value ? "var(--color-accent)" : "transparent",
              color: tab === value ? "var(--color-text)" : "var(--color-text-muted)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-6">
        {tab === "browse" && (
          <div className="grid grid-cols-2 gap-3">
            {LISTINGS.map((listing) => (
              <ToolCard
                key={listing.id}
                listing={listing}
                onShare={setShareTarget}
                onPaywall={() => setPaywallOpen(true)}
              />
            ))}
          </div>
        )}

        {tab === "shared" && (
          <div className="flex flex-col gap-3">
            <div className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
              Sent to you
            </div>
            {incoming.length === 0 && (
              <div className="text-[12.5px]" style={{ color: "var(--color-text-faint)" }}>
                Nothing shared with you yet.
              </div>
            )}
            {incoming.map((item) => {
              const listing = LISTINGS.find((entry) => entry.id === item.listingId);
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-xl border p-4"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <div>
                    <div className="text-[13px] font-medium">{listing?.name ?? item.listingId}</div>
                    <div className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
                      @{item.from} · {item.note}
                    </div>
                  </div>
                  {item.status === "pending" ? (
                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => decline(item.id)}>
                        Decline
                      </Button>
                      <Button variant="primary" onClick={() => accept(item.id)}>
                        Accept
                      </Button>
                    </div>
                  ) : (
                    <span
                      className="text-[11.5px]"
                      style={{ color: item.status === "accepted" ? "var(--color-green)" : "var(--color-text-faint)" }}
                    >
                      {item.status === "accepted" ? "Added" : "Declined"}
                    </span>
                  )}
                </div>
              );
            })}

            <div className="pt-3 text-[11px]" style={{ color: "var(--color-text-faint)" }}>
              Sent by you
            </div>
            {outgoing.length === 0 ? (
              <div className="text-[12.5px]" style={{ color: "var(--color-text-faint)" }}>
                You haven't shared anything yet.
              </div>
            ) : (
              outgoing.map((item) => {
                const listing = LISTINGS.find((entry) => entry.id === item.listingId);
                return (
                  <div key={item.id} className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
                    {listing?.name ?? item.listingId} → @{item.to}
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === "mine" && (
          <div className="grid grid-cols-2 gap-3">
            {myListings.length === 0 && (
              <div className="col-span-2 text-[12.5px]" style={{ color: "var(--color-text-faint)" }}>
                You haven't published anything. Use Publish to list a tool.
              </div>
            )}
            {myListings.map((listing) => (
              <ToolCard
                key={listing.id}
                listing={listing}
                onShare={setShareTarget}
                onPaywall={() => setPaywallOpen(true)}
              />
            ))}
          </div>
        )}
      </div>

      {publishOpen && (
        <Modal onClose={() => setPublishOpen(false)}>
          <div className="text-[13.5px] font-medium">Publish a tool</div>
          <p className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
            This is a demo listing — it appears in the marketplace immediately.
          </p>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tool name"
            className="w-full rounded-lg border px-3 py-2 text-[12.5px] outline-none"
            style={{ borderColor: "var(--color-border-strong)", background: "var(--color-page)" }}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does it do?"
            rows={3}
            className="w-full resize-none rounded-lg border px-3 py-2 text-[12.5px] outline-none"
            style={{ borderColor: "var(--color-border-strong)", background: "var(--color-page)" }}
          />
          <div className="flex items-center gap-3">
            <label className="flex-1 text-[12px]">
              Price ($)
              <input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-[12.5px] outline-none"
                style={{ borderColor: "var(--color-border-strong)", background: "var(--color-page)" }}
              />
            </label>
            <label className="flex items-center gap-2 pt-4 text-[12px]">
              <input type="checkbox" checked={proOnly} onChange={(e) => setProOnly(e.target.checked)} />
              Pro only
            </label>
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              onClick={() => {
                publish({
                  id: `me-${Date.now()}`,
                  name: name.trim(),
                  description: description.trim() || "A tool published from GitRun.",
                  author: "you",
                  price: Number(price) || 0,
                  premium: proOnly,
                  rating: 5,
                  installs: "0",
                  color: "#E6F1FB",
                  category: "Your tool",
                });
                setPublishOpen(false);
                setName("");
                setDescription("");
                setPrice("0");
                setProOnly(false);
                setTab("mine");
              }}
            >
              Publish
            </Button>
          </div>
        </Modal>
      )}

      {shareTarget && (
        <Modal onClose={() => setShareTarget(null)}>
          <div className="text-[13.5px] font-medium">Share {shareTarget.name}</div>
          <p className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
            Send it to a GitRun username. They can accept it from their Marketplace.
          </p>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="@username"
            className="w-full rounded-lg border px-3 py-2 text-[12.5px] outline-none"
            style={{ borderColor: "var(--color-border-strong)", background: "var(--color-page)" }}
          />
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShareTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!username.trim()}
              onClick={() => {
                share(shareTarget.id, username);
                setShareTarget(null);
                setUsername("");
              }}
            >
              Send
            </Button>
          </div>
        </Modal>
      )}

      {paywallOpen && (
        <Modal onClose={() => setPaywallOpen(false)}>
          <div className="text-[15px] font-medium">GitRun Premium</div>
          <p className="text-[12px]" style={{ color: "var(--color-text-muted)" }}>
            Unlock the Pro catalogue, share unlimited tools, and publish to the marketplace.
          </p>
          <div className="rounded-lg border p-3 text-[12px]" style={{ borderColor: "var(--color-border)", background: "var(--color-page)" }}>
            <div className="text-[16px] font-medium">
              $9<span className="text-[12px]"> / month</span>
            </div>
            <div className="text-[11px]" style={{ color: "var(--color-text-faint)" }}>
              Free trial · cancel anytime
            </div>
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPaywallOpen(false)}>
              Not now
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                activate();
                setPaywallOpen(false);
              }}
            >
              Start free trial
            </Button>
          </div>
        </Modal>
      )}

      {redeemOpen && (
        <Modal onClose={() => setRedeemOpen(false)}>
          <div className="text-[13.5px] font-medium">Redeem a code</div>
          <p className="text-[11.5px]" style={{ color: "var(--color-text-muted)" }}>
            Have an access code? Enter it to unlock Premium.
          </p>
          <input
            autoFocus
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setCodeError(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (redeem(code)) {
                setRedeemOpen(false);
                setCode("");
              } else {
                setCodeError("That code isn't valid.");
              }
            }}
            placeholder="GITRUN-PRO"
            className="w-full rounded-lg border px-3 py-2 text-[12.5px] outline-none"
            style={{ borderColor: "var(--color-border-strong)", background: "var(--color-page)" }}
          />
          {codeError && (
            <div className="text-[11.5px]" style={{ color: "var(--color-red)" }}>
              {codeError}
            </div>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRedeemOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!code.trim()}
              onClick={() => {
                if (redeem(code)) {
                  setRedeemOpen(false);
                  setCode("");
                } else {
                  setCodeError("That code isn't valid.");
                }
              }}
            >
              Unlock
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
