<script setup lang="ts">
import { ArrowUpRight } from "@lucide/vue";
import { RouterLink } from "vue-router";
import AppFooter from "@/components/AppFooter.vue";
</script>

<template>
  <main class="page docs-page">
    <header class="docs-hero">
      <p class="docs-eyebrow">SWAPUTER / PROTOCOL HANDBOOK</p>
      <h1>Swaputer 协议</h1>
      <p>
        Swaputer 是一个由 Swap 驱动的可编程结算协议。它让一次资产交换能够在同一笔链上交易中触发 SVM 程序，并将执行结果与交换一同结算。
      </p>
    </header>

    <div class="docs-layout">
      <aside class="docs-nav" aria-label="文档目录">
        <p>阅读导览</p>
        <a href="#protocol">协议是什么</a>
        <a href="#execution">协议如何执行</a>
        <a href="#use-cases">场景用例</a>
        <a href="#developers">开发者指南</a>
      </aside>

      <article class="docs-article">
        <section id="protocol" class="docs-intro">
          <p class="docs-kicker">01 / 协议是什么</p>
          <h2>让交换成为程序的起点。</h2>
          <p>
            Swaputer 关心的是交换之后会发生什么。当用户发起一次符合协议规则的 Swap 时，这笔交易可以继续执行一段 SVM 程序。程序可以保存状态、调用其他程序、创建资产，或定义新的应用行为。
          </p>
          <p>
            Swaputer 不是另一条区块链，也不是把桥、代币或市场硬编码进协议的产品。它是一层嵌入链上结算过程的执行环境：应用在其上运行，规则由公开、不可变的程序定义。
          </p>
          <div class="docs-principles" aria-label="Swaputer 协议原则">
            <div><strong>World</strong><span>一套固定的运行规则</span></div>
            <div><strong>SVM</strong><span>执行程序与保存状态</span></div>
            <div><strong>Program</strong><span>定义资产与应用行为</span></div>
          </div>
          <div class="docs-explainer">
            <div>
              <h3>World：一座规则不被暗改的运行环境</h3>
              <p>World 把 SVM 的运行版本、结算环境与执行边界固定下来。它不是一个可被管理员随时替换的后台配置，而是应用共同生活的规则空间。新的规则应当进入新的 World，而不是改写已经发生的历史。</p>
            </div>
            <div>
              <h3>Action：用户亲自授权的意图</h3>
              <p>每一项有状态行动都从用户签名开始。签名会绑定行动者、目标程序、调用内容、执行上限与有效期，让任何执行都对应一份清楚、有限且可验证的授权，而不是一张无限期的空白支票。</p>
            </div>
            <div>
              <h3>Program：资产与应用真正的定义</h3>
              <p>在 Swaputer 中，SRC20、市场、桥接资产或未来的游戏规则，本质上都是程序。程序的代码与身份相连，部署后不会被悄悄替换；用户看到的行为，应当与它实际运行的代码一致。</p>
            </div>
            <div>
              <h3>Events：让链上结果能够被理解</h3>
              <p>成功的执行会留下按顺序排列的 Events。它们不是营销层的展示数据，而是浏览器、钱包和应用理解资产变化、程序调用与应用事件的共同依据。</p>
            </div>
          </div>
        </section>

        <section id="execution" class="docs-story docs-execution">
          <p class="docs-kicker">02 / 协议如何执行</p>
          <h2>一笔交易，一条可以完整验证的执行路径。</h2>
          <p>
            用户不需要把交换和程序调用拆成两次等待。Swaputer 把签署的意图、Swap、SVM 执行、状态更新与 Events 放进同一次结算，按以下顺序完成。
          </p>
          <ol class="docs-execution-path">
            <li><span>01</span><div><strong>签署 Action</strong><p>用户选择要调用或部署的程序，并签署行动者、目标、参数、执行上限、价格保护与有效期。协议只接受与这份意图完全一致的执行，不让提交交易的一方获得额外权限。</p></div></li>
            <li><span>02</span><div><strong>执行 Swap</strong><p>Swap 是协议行动的结算入口。它确认真实资产的交换条件，同时为接下来的程序执行提供确定的上下文。价值移动与程序开始运行，发生在同一笔链上交易之内。</p></div></li>
            <li><span>03</span><div><strong>运行 SVM</strong><p>SVM 执行目标程序。程序可以读写持久状态、发起内部调用，或创建新的程序；所有路径共享同一份执行边界。执行成本按实际完成的工作计算，而用户在签名时已预先设定可接受的最高上限。</p></div></li>
            <li><span>04</span><div><strong>提交或回滚</strong><p>只有 Swap、执行与状态变化全部成功，结果与 Events 才会写入链上。任何一步失败，资产交换、程序状态、授权序号与记录都会一起回滚，因此不存在“付了钱但没有结果”的中间状态。</p></div></li>
          </ol>
          <div class="docs-execution-details">
            <div><strong>权限边界</strong><p>签名明确指定谁可以代表用户提交行动；程序只能在用户授权与 World 规则允许的范围内执行。</p></div>
            <div><strong>成本边界</strong><p>执行不是无限的。用户为本次行动设定上限，协议只按实际执行量结算相应成本。</p></div>
            <div><strong>验证边界</strong><p>每个程序以不可变代码建立身份。任何人都能部署新程序，任何人也都能验证它实际执行了什么。</p></div>
          </div>
        </section>

        <section id="use-cases" class="docs-story">
          <p class="docs-kicker">03 / 场景用例</p>
          <h2>协议定义执行方式，应用定义它要带来的新可能。</h2>
          <p>
            Bridge、SRC20、Market 和 Studio 是 Swaputer 协议的第一批应用。它们展示同一套执行能力如何服务于不同的价值流动与创造方式，而不是协议本身的限制。
          </p>
          <div class="docs-use-cases">
            <article><span>01</span><h3>Bridge</h3><p>原生 ETH 可以沿着明确的 1:1 规则进入 SVM，成为 sETH。桥将抵押、铸造与赎回放进同一套可验证的约束中，让原生价值获得参与程序世界的入口。</p><RouterLink to="/bridge">体验 Bridge <ArrowUpRight :size="14" aria-hidden="true" /></RouterLink></article>
            <article><span>02</span><h3>SRC20</h3><p>同质化资产的名称、供应、铸造与转移行为由 SVM 程序定义。SRC20 是参考实现，而不是 Kernel 的特殊分支：未来的资产标准也可以沿同一条路径被创造。</p><RouterLink to="/contracts">查看合约 <ArrowUpRight :size="14" aria-hidden="true" /></RouterLink></article>
            <article><span>03</span><h3>Market</h3><p>买卖意愿、订单与成交在统一结算中相遇。市场不需要替资产创造一套新的账本，而是直接读取并调用它的程序规则，使任何 SRC20 都能形成自己的开放市场。</p><RouterLink to="/market">进入 Market <ArrowUpRight :size="14" aria-hidden="true" /></RouterLink></article>
            <article><span>04</span><h3>Studio</h3><p>新的资产机制、协作方式与应用逻辑，都可以被写成迷你合约并部署到 SVM。Studio 让协议从一组已知应用，变成一个可以持续产生新应用的创作环境。</p><RouterLink to="/studio">探索 Studio <ArrowUpRight :size="14" aria-hidden="true" /></RouterLink></article>
          </div>
          <p class="docs-use-case-note">这些只是开始。协议不决定什么应用值得出现；它负责让每一种新的规则，都拥有清楚的执行方式与可验证的结果。</p>
        </section>

        <section id="developers" class="docs-story docs-developers">
          <p class="docs-kicker">04 / 开发者指南</p>
          <h2>在 SVM 上构建的，不只是合约，而是一段能够被结算的行为。</h2>
          <p>
            Swaputer 为开发者提供 TinySol、SVM 包、确定性的部署身份与统一的 Events 模型。你可以从一个简单的资产规则开始，也可以组合多个程序，构建市场、积分系统、游戏或尚未命名的应用。
          </p>
          <p>
            开发前先记住一个核心事实：SVM 程序不是独立运行的后台任务。它们由一项明确的 Action 触发，并在协议规定的执行边界中完成。把状态、成本和失败路径设计清楚，是 SVM 开发的一部分。
          </p>

          <div class="docs-developer-map" aria-label="开发者工作流">
            <div><span>01</span><strong>编写</strong><p>使用 TinySol 定义状态、函数、事件与构造参数。</p></div>
            <div><span>02</span><strong>编译</strong><p>生成可验证的 SVM 包与 ABI、事件、布局等产物。</p></div>
            <div><span>03</span><strong>部署</strong><p>将不可变程序注册并部署到指定 World。</p></div>
            <div><span>04</span><strong>调用</strong><p>用户签署 Action，程序随协议结算被执行。</p></div>
          </div>

          <div class="docs-dev-block" id="tinysol">
            <h3>从 TinySol 开始</h3>
            <p>
              TinySol 是面向 SVM 的迷你合约语言。它刻意保持小而确定：状态变量、映射、条件、循环、事件、内部函数、外部函数和受类型约束的程序调用，覆盖了大多数应用的起点。
              它不追求复刻 EVM 的全部表面，而是让合约的执行路径、存储布局与构建产物保持可读和可验证。
            </p>
            <pre class="docs-code"><code>contract Counter {
  uint256 count;

  event Incremented(account indexed caller, uint256 value);

  constructor(uint256 initial) {
    count = initial;
  }

  function increment(uint256 amount) external {
    require(amount &gt; 0);
    count = count + amount;
    emit Incremented(msg.sender, count);
  }

  function current() external view returns (uint256) {
    return count;
  }
}</code></pre>
            <p>
              上例中的 <code>count</code> 是持久化状态；构造函数只在部署时运行；<code>increment</code> 是可以从外部 Action 调用的入口；<code>current</code> 是只读查询。
              标记为 <code>internal</code> 的函数只是同一程序内的帮助函数，不会暴露给外部 ABI 或 dispatch 表。
            </p>
          </div>

          <div class="docs-dev-block" id="artifacts">
            <h3>编译出的不只是字节码</h3>
            <p>
              一次 TinySol 编译会生成可部署的 <code>.svm</code> 包，以及 ABI、事件描述、存储布局、汇编、源映射和构建清单。它们共同描述“这份程序是什么”，而不只是“它能不能运行”。
            </p>
            <div class="docs-artifact-list">
              <div><code>.svm</code><span>带版本、入口与 ABI 哈希的 SVM 程序包。</span></div>
              <div><code>ABI</code><span>外部函数、构造函数与静态参数的调用约定。</span></div>
              <div><code>Events</code><span>供浏览器和索引器解读 Events 的事件描述。</span></div>
              <div><code>Storage layout</code><span>状态槽位与映射域的确定性布局记录。</span></div>
              <div><code>Manifest</code><span>源代码、ABI、布局、描述与程序包哈希的构建承诺。</span></div>
            </div>
            <p>
              Studio 将这条流程带到浏览器中：编写后即可编译、检查构造参数、部署，并对已部署程序发起调用。对于自动化工作流，TinySol 命令行同样可以产出相同的确定性工件。
            </p>
            <RouterLink class="docs-inline-link" to="/studio">打开 Studio <ArrowUpRight :size="14" aria-hidden="true" /></RouterLink>
          </div>

          <div class="docs-dev-block" id="calling">
            <h3>部署、调用与组合</h3>
            <p>
              部署会注册程序包并运行构造函数，产生确定的迷你合约账户。调用则从外部函数开始：运行时 calldata 由四字节函数选择器和每个参数的一个 32 字节静态字组成；构造参数不带选择器，也遵循相同的静态编码原则。
            </p>
            <p>
              程序之间不通过任意 EVM 调用组合，而是通过声明的 TinySol interface 发起 <code>call</code> 或 <code>staticcall</code>。调用目标必须是 SVM <code>account</code>，只读调用只能指向声明为 <code>view</code> 的接口函数。子调用失败会向上传播，让根 Action 整体回滚。
            </p>
            <p>
              这种限制是有意的：组合关系是显式、可类型检查的；程序不能越过协议边界去调用任意外部合约，也不能通过 <code>delegatecall</code> 改写另一段代码的上下文。
            </p>
          </div>

          <div class="docs-dev-block" id="events">
            <h3>用 Events 让应用被看见</h3>
            <p>
              SVM 不为每种应用事件各自创造一套链上事件通道。每次成功执行产生统一的 Events，其中包含按真实执行顺序排列的内部记录。你的 <code>emit</code> 会进入这条记录流，浏览器与索引器再依据程序的事件描述进行展示和查询。
            </p>
            <p>
              不要把函数名或事件主题当作可信身份。只有当程序包的不可变代码身份与已知参考实现匹配时，浏览器才应把它标记为对应标准资产或标准事件。自定义程序仍然可以完全开放地发出自己的事件，但应被如实展示为自定义行为。
            </p>
          </div>

          <div class="docs-dev-block" id="constraints">
            <h3>设计边界与安全习惯</h3>
            <div class="docs-constraints">
              <div><strong>为失败设计</strong><p><code>require</code>、<code>revert</code> 与子调用失败都会回滚根执行。先明确什么情况下应该停止，再设计成功路径。</p></div>
              <div><strong>为成本设计</strong><p>循环与嵌套调用都会计入实际执行量。保持循环边界清楚，避免让用户难以预估一次 Action 的执行成本。</p></div>
              <div><strong>为不可变性设计</strong><p>部署后的程序不会升级。将关键参数放进构造函数，把版本变更视为新的程序或新的 World，而不是事后修补。</p></div>
              <div><strong>为类型设计</strong><p><code>account</code> 与 EVM <code>address</code> 是不同类型，不能互相转换。用 <code>account</code> 指向 SVM 程序，用 <code>address</code> 表示 EVM 身份。</p></div>
              <div><strong>为确定性设计</strong><p>不要将公开的区块字段视为安全随机数。避免依赖隐式转换、动态数据或未定义的外部环境。</p></div>
              <div><strong>了解语言边界</strong><p>TinySol v1 不支持动态数组、字符串、EVM 调用、代理升级、异常捕获或运行时签名字符串；将这些限制当作设计前提。</p></div>
            </div>
          </div>
        </section>

        <section class="docs-closing">
          <p>从这里开始</p>
          <h2>理解协议，选择一个应用，或者写下一个新的应用。</h2>
          <div>
            <RouterLink to="/bridge"><span>体验 Bridge</span><ArrowUpRight :size="15" aria-hidden="true" /></RouterLink>
            <RouterLink to="/contracts"><span>查看合约</span><ArrowUpRight :size="15" aria-hidden="true" /></RouterLink>
            <RouterLink to="/market"><span>进入 Market</span><ArrowUpRight :size="15" aria-hidden="true" /></RouterLink>
          </div>
        </section>
      </article>
    </div>

    <AppFooter />
  </main>
</template>
