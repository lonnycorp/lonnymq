import { node } from "@lonnycorp/htmlforge"
import { Logo } from "@src/component/logo.ts"
import { Nav, type MainNavKey } from "@src/component/nav.ts"

type MainOptions = {
    selectedNavKey?: MainNavKey
}

export class Main implements node.Buildable {
    private readonly root = new node.Element("main")
        .style("box-sizing", "border-box")
        .style("flex", "1 0 auto")
        .style("max-width", "980px")
        .style("width", "100%")

    constructor(options: MainOptions = {}) {
        this.root
            .child(new Logo())
            .child(new Nav({ selectedKey: options.selectedNavKey }))
    }

    child(child: node.Buildable) {
        this.root.child(child)
        return this
    }

    build() {
        return this.root.build()
    }
}
