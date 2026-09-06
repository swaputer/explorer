import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Box,
  CircleDollarSign,
  FileText,
  Layers3,
  Search,
  ShieldCheck,
  Workflow
} from "lucide-react";

const chapters = [
  { id: "opening", number: "", title: "序章", summary: "从一个问题开始" },
  { id: "waiting-liquidity", number: "1.", title: "流动性一直在等待", summary: "池子之外的可能性" },
  { id: "transactions-run-code", number: "2.", title: "当交易开始运行程序", summary: "交换与执行成为一件事" },
  { id: "birth-of-world", number: "3.", title: "一个 World 的诞生", summary: "属于应用的计算经济" },
  { id: "small-contracts", number: "4.", title: "小合约，大组合", summary: "Mini Contract 为什么更小" },
  { id: "value-crosses-boundaries", number: "5.", title: "价值穿越边界", summary: "代币、市场与 sETH" },
  { id: "intent-over-permission", number: "6.", title: "意图比权限更重要", summary: "用户究竟签署了什么" },
  { id: "safety-through-restraint", number: "7.", title: "安全来自克制", summary: "协议选择不做什么" },
  { id: "where-we-are", number: "8.", title: "我们走到哪里", summary: "今天与下一程" }
] as const;

function scrollToChapter(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.history.replaceState(null, "", "#" + id);
}

export function ProtocolDocsPage() {
  const [active, setActive] = useState("opening");
  const [query, setQuery] = useState("");
  const visibleChapters = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? chapters.filter((chapter) => (chapter.title + " " + chapter.summary).toLowerCase().includes(normalized))
      : chapters;
  }, [query]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target.id) setActive(visible.target.id);
    }, { rootMargin: "-18% 0px -68%", threshold: [0, 0.2, 0.6] });
    chapters.forEach((chapter) => {
      const element = document.getElementById(chapter.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <main className="docs-main">
      <header className="docs-mobile-head">
        <BookOpen size={17} /><span>Swaputer 协议手册</span><small>中文 · 叙事版</small>
      </header>
      <div className="docs-layout">
        <aside className="docs-sidebar" aria-label="文档章节">
          <div className="docs-book-title">
            <BookOpen size={18} />
            <div><strong>Swaputer 协议手册</strong><span>中文 · 叙事版</span></div>
          </div>
          <label className="docs-search">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索章节" aria-label="搜索文档章节" />
          </label>
          <nav>
            {visibleChapters.map((chapter) => (
              <button key={chapter.id} type="button" className={active === chapter.id ? "docs-nav-active" : ""} onClick={() => scrollToChapter(chapter.id)}>
                <span>{chapter.number}</span>
                <div><strong>{chapter.title}</strong><small>{chapter.summary}</small></div>
              </button>
            ))}
            {visibleChapters.length === 0 && <p className="docs-no-results">没有匹配的章节</p>}
          </nav>
          <div className="docs-version"><span>当前篇章</span><strong><i /> 协议故事 · 第一版</strong></div>
        </aside>

        <article className="docs-article docs-story">
          <section id="opening" className="docs-section docs-introduction">
            <span className="docs-kicker">The Story of Swaputer</span>
            <h1>序章</h1>
            <p className="docs-lead">每一个链上协议，都在回答同一个问题：有限的资源，应该如何被发现、交换和使用？</p>
            <p>Uniswap 给出过一个重要答案。它让资本不必等待中心化的撮合者，而是留在公开的池子里，随时准备为下一笔交易提供价格。</p>
            <p>Swaputer 从这个答案继续往前走了一步。我们开始想：如果流动性可以为资产交换提供价格，它能不能也为软件执行提供资源？如果一笔交易不仅能改变余额，还能在同一瞬间运行一个程序，会发生什么？</p>
            <blockquote className="docs-story-quote">
              <span>“</span>
              <p>Swaputer 的故事，不是把一台虚拟机放到 Uniswap 旁边。它是让流动性本身成为程序开始运行的地方。</p>
            </blockquote>
          </section>

          <section id="waiting-liquidity" className="docs-section">
            <span className="docs-chapter">1. 流动性一直在等待</span>
            <h2>池子有很多时间没有被使用</h2>
            <p>流动性池最熟悉的工作，是在两种资产之间完成交换。但在两笔交易之间，池中的资本只是安静地等待。它拥有价格，也拥有深度，却没有参与软件世界中另一种持续发生的需求：计算。</p>
            <p>传统区块链把计算当作一种独立的全局资源。用户先获得网络原生资产，再用它支付 Gas。应用自己的市场、资产和用户，与计算资源的价格往往没有直接关系。</p>
            <p>Swaputer 提出的直觉很简单：一个应用既然可以拥有自己的流动性，也应该能够拥有自己的执行经济。使用这个应用的人，可以从同一个公开市场中获得运行程序所需的资源。</p>
            <div className="docs-story-break">
              <Layers3 size={20} />
              <div><small>起点</small><strong>流动性不再只等待下一笔交换，它也在等待下一次执行。</strong></div>
            </div>
          </section>

          <section id="transactions-run-code" className="docs-section">
            <span className="docs-chapter">2. 当交易开始运行程序</span>
            <h2>一笔 ETH，同时完成两件事</h2>
            <p>在 Swaputer 中，用户送入 ETH 时，买到的不只是另一种代币。他同时获得了一次程序执行所需的资源。</p>
            <p>交换发生在 Uniswap v4 中，程序运行在 SwapVM 中。它们看起来属于两个世界，却共享同一个结果：如果资源交换成功而程序失败，交换会回滚；如果程序成功而结算无法完成，程序产生的状态也不会留下。</p>
            <div className="docs-flow docs-story-flow" aria-label="一笔 Swaputer 交易的故事">
              <div><span>01</span><strong>用户表达意图</strong><small>我想运行什么</small></div>
              <div><span>02</span><strong>流动性提供资源</strong><small>ETH 进入公开市场</small></div>
              <div><span>03</span><strong>Mini Contract 执行</strong><small>程序改变内部状态</small></div>
              <div><span>04</span><strong>世界接受新结果</strong><small>或者一切回到原点</small></div>
            </div>
            <p>原子性让这套关系变得可信。应用不必相信一个链下服务会在稍后补做另一半操作，用户也不必在资产已经移动之后等待程序给出答案。</p>
          </section>

          <section id="birth-of-world" className="docs-section">
            <span className="docs-chapter">3. 一个 World 的诞生</span>
            <h2>每个应用都可以拥有自己的计算经济</h2>
            <p>SwapVM World 可以被理解为一块有边界的链上领地。它拥有自己的流动性池、执行资源、程序状态和计量方式。</p>
            <p>World 创建时，这些关系会被一起确定下来。哪个池子提供资源，哪个 Kernel 解释程序，每执行一段代码需要消耗多少资源，都在那一刻成为公开规则。</p>
            <p>随后，World 被封存。封存不是一个技术上的仪式，而是一份承诺：今天签署的动作，不会因为明天有人替换了执行环境而拥有另一种含义。</p>
            <div className="docs-principles docs-story-principles">
              <article><CircleDollarSign size={19} /><strong>自己的市场</strong><p>执行资源拥有公开价格，而不是由某个后台单方面报价。</p></article>
              <article><Workflow size={19} /><strong>自己的程序空间</strong><p>应用逻辑和状态生活在同一个可验证的 World 中。</p></article>
              <article><ShieldCheck size={19} /><strong>不变的规则</strong><p>World 一旦 sealed，关键绑定便不能被悄悄替换。</p></article>
            </div>
          </section>

          <section id="small-contracts" className="docs-section">
            <span className="docs-chapter">4. 小合约，大组合</span>
            <h2>Mini Contract 的“小”是一种选择</h2>
            <p>通用虚拟机希望容纳所有可能的软件。SwapVM 选择了一条更窄的路：让程序保持轻量，让状态边界和执行成本更容易理解。</p>
            <p>这些程序被称为 Mini Contract。它们可以保存状态、转移资产、调用其他程序，也可以参与更大的协议流程。但每个程序都有确定的代码身份和明确的资源上限。</p>
            <p>TinySol 为这些程序提供了一种更接近合约开发者习惯的语言。开发者可以在浏览器里的 Studio 写下规则，亲眼看见它变成可验证的 SVM package，再把它带到链上。部署之后，程序是谁，不由一个名字决定，而由它真实的代码决定。</p>
            <div className="docs-story-break">
              <Box size={20} />
              <div><small>设计选择</small><strong>不是让 Mini Contract 模仿一切，而是让它专注完成一件可以被组合的事。</strong></div>
            </div>
          </section>

          <section id="value-crosses-boundaries" className="docs-section">
            <span className="docs-chapter">5. 价值穿越边界</span>
            <h2>协议真正开始生长</h2>
            <p>一台虚拟机只有运行样例时，还不是一个协议。真正重要的时刻，是价值开始在 EVM、流动性池和 Mini Contract 之间穿行。</p>
            <div className="docs-app-grid docs-story-apps">
              <article><CircleDollarSign /><span>01</span><h3>一枚代币学会遵守规则</h3><p>SRC20 让资产生活在 MiniVM 中。余额、转账和发行不再是演示指令，而是应用可以依赖的共同语言。</p></article>
              <article><Layers3 /><span>02</span><h3>买家和卖家在边界相遇</h3><p>市场把 EVM 中的 ETH 与 MiniVM 中的 SRC20 放进同一次结算，让任何一方失败时另一方都不会被留在原地。</p></article>
              <article><Workflow /><span>03</span><h3>一份被完整托管的承诺</h3><p>sETH 不是凭空出现的记账单位。每一份供应都对应 Vault 中锁定的 ETH，赎回时销毁与付款一起发生。</p></article>
            </div>
            <p>这些应用看起来不同，却共享同一种结构：EVM 擅长持有真实资产和连接外部协议，MiniVM 擅长表达小而确定的规则，Swaputer 负责让两边只接受同一个最终结果。</p>
          </section>

          <section id="intent-over-permission" className="docs-section">
            <span className="docs-chapter">6. 意图比权限更重要</span>
            <h2>用户签署的不是一张空白支票</h2>
            <p>链上交互常常被描述为“授权一个合约”。但授权太宽，意味着用户必须相信执行者不会做更多事情。</p>
            <p>Swaputer 更在意完整的意图。用户签署的是一次具体行动：在哪个 World，运行哪个程序，带着什么参数，允许消耗多少资源，把结果交给谁，以及谁有资格提交它。</p>
            <p>这让市场和桥拥有一种重要能力。它们可以成为某份签名唯一认可的执行者，从而保证用户不能绕过托管规则，第三方也不能把同一份签名带到另一条路径上使用。</p>
            <blockquote className="docs-story-quote docs-story-quote--small">
              <span>“</span>
              <p>权限回答“你可以做什么”，意图回答“我这一次究竟同意了什么”。</p>
            </blockquote>
          </section>

          <section id="safety-through-restraint" className="docs-section">
            <span className="docs-chapter">7. 安全来自克制</span>
            <h2>有些能力，我们主动没有加入</h2>
            <p>协议很容易通过增加管理员、紧急开关和可升级入口来获得短期便利。但每一个额外入口，也会让用户更难判断真正控制结果的人是谁。</p>
            <div className="docs-security-list docs-story-beliefs">
              <article><strong>01</strong><div><h3>规则先于治理便利</h3><p>World 的关键关系在创建后封存，程序身份与实际代码绑定。</p></div></article>
              <article><strong>02</strong><div><h3>失败必须完整</h3><p>交换、执行、状态和托管结算不能留下半个成功的结果。</p></div></article>
              <article><strong>03</strong><div><h3>边界必须看得见</h3><p>程序大小、执行深度、资源预算和签名有效期都有明确上限。</p></div></article>
              <article><strong>04</strong><div><h3>实验必须诚实</h3><p>没有审计和长期运行证据之前，测试网成果不能被包装成生产安全。</p></div></article>
            </div>
            <div className="docs-callout docs-callout--warning"><ShieldCheck size={19} /><div><strong>当前仍是实验协议</strong><p>Base Sepolia 部署只承载零价值测试。这里描述的是我们的设计方向，不是对真实资金安全性的承诺。</p></div></div>
          </section>

          <section id="where-we-are" className="docs-section">
            <span className="docs-chapter">8. 我们走到哪里</span>
            <h2>故事已经开始，但还没有写完</h2>
            <p>今天，Swaputer 已经拥有可以运行的 World、签名执行、浏览器里的 TinySol Studio、Mini Contract 部署、SRC20 市场和 ETH / sETH 原子桥。它们不再只是白皮书中的箭头，而是可以被编译、测试和观察的系统。</p>
            <p>但“可以运行”与“值得托付”之间还有很长的距离。独立审计、更长时间的测试网运行、公开监控、开发者工具和更清晰的协议规范，仍然是下一阶段必须完成的工作。</p>
            <div className="docs-now">
              <div><small>现在</small><strong>证明流动性可以成为执行资源</strong></div>
              <ArrowRight size={18} />
              <div><small>接下来</small><strong>让开发者能够安全地创造自己的 World</strong></div>
            </div>
            <p className="docs-closing">我们相信，链上软件的未来不只是把更多程序塞进同一台机器。它也可以让每个应用拥有自己的资源、自己的规则，以及一条把流动性变成行动的路径。</p>
            <button type="button" className="docs-next" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
              <span><small>回到序章</small><strong>从最初的问题重新开始</strong></span><ArrowRight size={19} />
            </button>
          </section>
        </article>

        <aside className="docs-toc" aria-label="本页目录">
          <strong>故事章节</strong>
          <nav>{chapters.map((chapter) => <button key={chapter.id} type="button" className={active === chapter.id ? "active" : ""} onClick={() => scrollToChapter(chapter.id)}>{chapter.title}</button>)}</nav>
          <div><FileText size={15} /><p><strong>叙事版 · 第一版</strong><span>技术规格将独立整理</span></p></div>
        </aside>
      </div>
    </main>
  );
}
