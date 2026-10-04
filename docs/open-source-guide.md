# 从文件夹到开源仓库

## 开源的是源码

将代码发布到公共仓库，配上许可证，别人才能明确知道允许怎样使用。开源源码和运营在线网站是两件事：别人 Fork 后自行部署，使用自己的账号和额度；访问某个现成网站，则消耗该网站部署者的资源。

本项目不包含作者的 Netlify 项目绑定、平台令牌、活动数据或固定远程后端。

## 几个动作分别是什么意思

| 动作 | 含义 |
| --- | --- |
| Repository（仓库） | 项目文件及其版本历史的集合 |
| git init | 在文件夹中建立本地版本记录 |
| git add | 选择哪些变化进入下一次提交 |
| git commit | 将选中的变化保存成一个版本 |
| git push | 将本地提交上传到远程仓库 |
| Clone | 下载仓库及历史到电脑 |
| Fork | 在自己的 GitHub 账号下建立仓库副本 |
| Issue | 报告问题或讨论需求 |
| Pull Request | 提议将一组修改合并进项目 |

`.gitignore` 决定哪些未跟踪文件默认不加入 Git；它不能删除已经提交到历史里的秘密。

## 许可

MIT 允许使用、修改、分发和商用，要求保留版权和许可声明，并包含免责条款。公开仓库本身不等于明确授予完整的开源使用许可。

参见 [MIT 许可说明](https://choosealicense.com/licenses/mit/) 和本仓库 LICENSE。

## 第一次发布的顺序

1. 选择源码及必要配置，排除私有数据、凭证和本机生成目录。
2. 整理 README、许可证、第三方声明和运行说明。
3. 在干净依赖环境中测试，确认没有依赖作者机器上的绝对路径。
4. 初始化 Git，检查待提交文件，生成第一个 commit。
5. 使用自己的账号创建 GitHub 公共仓库并 push。
6. 检查远程文件、README、许可证识别以及从干净克隆运行的结果。

GitHub 托管源码并不自动部署本项目的后端。部署说明见 README。

## 之后怎样更新

修改源码 → 测试 → git add → git commit → git push。

如果网站配置了连接该仓库的自动部署，push 才可能触发线上更新；没有配置时，仍需单独部署。

官方参考：[将本地代码添加到 GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)。
