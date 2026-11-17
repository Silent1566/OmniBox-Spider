// @name 豆瓣推荐
// @indexs 1
// @author lampon
// @description 豆瓣推荐爬虫脚本
// @version 1.0.10
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/导航/豆瓣推荐.js

const OmniBox = require("omnibox_sdk");

// 导出接口
module.exports = {
  home,
  category,
};

// 使用公共 runner 处理标准输入/输出
const runner = require("spider_runner");
runner.run(module.exports);

function buildDoubanSubjectLink(vodId) {
  return `https://movie.douban.com/subject/${vodId}`;
}


/**
 * 获取首页数据
 * @param {Object} params - 参数对象
 * @returns {Object} 返回分类列表和推荐视频列表
 */
async function home(params, context) {
  try {
    // 构建分类列表
    const classes = [
      { type_id: "movie", type_name: "选电影" },
      { type_id: "tv", type_name: "选剧集" },
      { type_id: "show", type_name: "选综艺" },
      { type_id: "movie_filter", type_name: "电影筛选" },
      { type_id: "tv_filter", type_name: "电视剧筛选" },
      { type_id: "show_filter", type_name: "综艺筛选" },
    ];

    // 获取Banner数据（直接请求腾讯接口）
    let banner = [];
    try {
      const baseURL = context.baseURL || "";
      const tencentBannerUrl = "https://pbaccess.video.qq.com/trpc.vector_layout.page_view.PageService/getPage?video_appid=3000010&vversion_platform=2";

      // 构建请求体
      const requestData = {
        page_params: {
          page_type: "channel",
          page_id: "100113",
          scene: "channel",
          new_mark_label_enabled: "1",
          vl_to_mvl: "",
          free_watch_trans_info: "{\"ad_frequency_control_time_list\":{}}",
          ad_exp_ids: "100000",
          ams_cookies: "lv_play_index=26; o_minduid=CpGFdExDeM8uP-XHCyma_0PzurMADpcf; appuser=83C1297D3AE9DEFF",
          ad_trans_data: "{\"game_sessions\":[]}",
          skip_privacy_types: "0",
          support_click_scan: "1",
        },
        page_bypass_params: {
          params: {
            platform_id: "2",
            caller_id: "3000010",
            data_mode: "default",
            user_mode: "default",
            specified_strategy: "",
            page_type: "channel",
            page_id: "100113",
            scene: "channel",
            new_mark_label_enabled: "1",
          },
          scene: "channel",
          app_version: "",
          abtest_bypass_id: "aa836e91e1411155",
        },
        page_context: null,
      };

      const tencentBannerResponse = await OmniBox.request(tencentBannerUrl, {
        method: "POST",
        body: JSON.stringify(requestData),
      });

      if (tencentBannerResponse.statusCode === 200 && tencentBannerResponse.body) {
        let tencentBannerBodyStr = typeof tencentBannerResponse.body === "string" ? tencentBannerResponse.body : String(tencentBannerResponse.body);
        const tencentBannerData = JSON.parse(tencentBannerBodyStr);

        // 解析腾讯响应数据，提取轮播图卡片
        if (tencentBannerData.data && tencentBannerData.data.CardList && Array.isArray(tencentBannerData.data.CardList)) {
          for (const cardList of tencentBannerData.data.CardList) {
            // 只处理轮播图类型的卡片
            if (cardList.type === "pc_carousel" && cardList.children_list && cardList.children_list.list && cardList.children_list.list.cards) {
              const cards = cardList.children_list.list.cards;

              for (const card of cards) {
                // 只提取有背景图片的内容（pic_ori_2880x900）
                if (card.params && card.params.pic_ori_2880x900) {
                  // 处理背景图片URL
                  let backgroundImage = card.params.pic_ori_2880x900 || card.params.image_url || "";

                  // 如果图片URL是外部URL，需要通过代理
                  if (backgroundImage && baseURL && !backgroundImage.includes(baseURL) && backgroundImage.startsWith("http")) {
                    const urlWithHeaders = `${backgroundImage}@Referer=https://v.qq.com`;
                    const encodedUrl = encodeURIComponent(urlWithHeaders);
                    backgroundImage = `${baseURL}/api/proxy/image?url=${encodedUrl}`;
                  }

                  // 解析演员信息（从topic_label中提取）
                  let actors = "";
                  if (card.params.topic_label) {
                    const topicLabel = card.params.topic_label;
                    // topic_label格式可能是 "演员1 / 演员2" 或类似格式
                    const parts = topicLabel.split(" / ");
                    if (parts.length > 1) {
                      // 通常演员信息在后面的部分
                      actors = parts.slice(1).join(" / ");
                    } else {
                      actors = topicLabel;
                    }
                  }

                  banner.push({
                    title: card.params.title || card.params.title_pc || "",
                    subtitle: card.params.stitle_pc || card.params.material_video_subtitle || "",
                    backgroundImage: backgroundImage,
                    genre: card.params.main_genre || "",
                    actors: actors,
                    description: card.params.rec_normal_reason || "",
                  });

                  // 最多取5个
                  if (banner.length >= 5) {
                    break;
                  }
                }
              }

              // 如果已经取够5个，跳出外层循环
              if (banner.length >= 5) {
                break;
              }
            }
          }
        }
      }
    } catch (bannerError) {
      // Banner获取失败不影响首页数据返回
      await OmniBox.log("warn", `获取Banner数据失败: ${bannerError.message}`);
    }

    // 构建筛选条件
    // 选电影分类的筛选器
    const filters = {
      movie: [
        // 类型筛选器（category）
        {
          key: "category",
          name: "类型",
          init: "热门", // 默认值
          value: [
            { name: "热门", value: "热门" },
            { name: "最新", value: "最新" },
            { name: "豆瓣高分", value: "豆瓣高分" },
            { name: "冷门佳片", value: "冷门佳片" },
          ],
        },
        // 地区筛选器（type）
        {
          key: "type",
          name: "地区",
          init: "全部", // 默认值
          value: [
            { name: "全部", value: "全部" },
            { name: "华语", value: "华语" },
            { name: "欧美", value: "欧美" },
            { name: "韩国", value: "韩国" },
            { name: "日本", value: "日本" },
          ],
        },
      ],
      // 选剧集的筛选器
      tv: [
        {
          key: "type",
          name: "类型",
          init: "tv", // 默认值：国产剧
          value: [
            { name: "综合", value: "tv" },
            { name: "国产剧", value: "tv_domestic" },
            { name: "欧美剧", value: "tv_american" },
            { name: "日剧", value: "tv_japanese" },
            { name: "韩剧", value: "tv_korean" },
            { name: "动漫", value: "tv_animation" },
            { name: "纪录片", value: "tv_documentary" },
          ],
        },
      ],
      // 选综艺的筛选器
      show: [
        {
          key: "type",
          name: "类型",
          init: "show", // 默认值：综合
          value: [
            { name: "综合", value: "show" },
            { name: "国内", value: "show_domestic" },
            { name: "国外", value: "show_foreign" },
          ],
        },
      ],
      // 电影筛选的筛选器
      movie_filter: [
        // 类型筛选器
        {
          key: "genre",
          name: "类型",
          init: "", // 默认值：全部（空字符串）
          value: [
            { name: "全部", value: "" },
            { name: "喜剧", value: "喜剧" },
            { name: "爱情", value: "爱情" },
            { name: "动作", value: "动作" },
            { name: "科幻", value: "科幻" },
            { name: "动画", value: "动画" },
            { name: "悬疑", value: "悬疑" },
            { name: "犯罪", value: "犯罪" },
            { name: "惊悚", value: "惊悚" },
            { name: "冒险", value: "冒险" },
            { name: "音乐", value: "音乐" },
            { name: "历史", value: "历史" },
            { name: "奇幻", value: "奇幻" },
            { name: "恐怖", value: "恐怖" },
            { name: "战争", value: "战争" },
            { name: "传记", value: "传记" },
            { name: "歌舞", value: "歌舞" },
            { name: "武侠", value: "武侠" },
            { name: "情色", value: "情色" },
            { name: "灾难", value: "灾难" },
            { name: "西部", value: "西部" },
            { name: "纪录片", value: "纪录片" },
            { name: "短片", value: "短片" },
          ],
        },
        // 地区筛选器
        {
          key: "region",
          name: "地区",
          init: "", // 默认值：全部（空字符串）
          value: [
            { name: "全部", value: "" },
            { name: "华语", value: "华语" },
            { name: "欧美", value: "欧美" },
            { name: "韩国", value: "韩国" },
            { name: "日本", value: "日本" },
            { name: "中国大陆", value: "中国大陆" },
            { name: "美国", value: "美国" },
            { name: "中国香港", value: "中国香港" },
            { name: "中国台湾", value: "中国台湾" },
            { name: "英国", value: "英国" },
            { name: "法国", value: "法国" },
            { name: "德国", value: "德国" },
            { name: "意大利", value: "意大利" },
            { name: "西班牙", value: "西班牙" },
            { name: "印度", value: "印度" },
            { name: "泰国", value: "泰国" },
            { name: "俄罗斯", value: "俄罗斯" },
            { name: "加拿大", value: "加拿大" },
            { name: "澳大利亚", value: "澳大利亚" },
            { name: "爱尔兰", value: "爱尔兰" },
            { name: "瑞典", value: "瑞典" },
            { name: "巴西", value: "巴西" },
            { name: "丹麦", value: "丹麦" },
          ],
        },
        // 年代筛选器
        {
          key: "year",
          name: "年代",
          init: "", // 默认值：全部（空字符串）
          value: [
            { name: "全部", value: "" },
            { name: "2026", value: "2026" },
            { name: "2025", value: "2025" },
            { name: "2024", value: "2024" },
            { name: "2023", value: "2023" },
            { name: "2022", value: "2022" },
            { name: "2021", value: "2021" },
            { name: "2020", value: "2020" },
            { name: "2019", value: "2019" },
            { name: "2020年代", value: "2020年代" },
            { name: "2010年代", value: "2010年代" },
            { name: "2000年代", value: "2000年代" },
            { name: "90年代", value: "90年代" },
            { name: "80年代", value: "80年代" },
            { name: "70年代", value: "70年代" },
            { name: "60年代", value: "60年代" },
            { name: "更早", value: "更早" },
          ],
        },
        // 排序筛选器
        {
          key: "sort",
          name: "排序",
          init: "U", // 默认值：热度
          value: [
            { name: "热度", value: "U" },
            { name: "评分", value: "S" },
            { name: "时间", value: "R" },
          ],
        },
      ],
      // 电视剧筛选的筛选器
      tv_filter: [
        // 类型筛选器
        {
          key: "genre",
          name: "类型",
          init: "", // 默认值：全部（空字符串）
          value: [
            { name: "全部", value: "" },
            { name: "喜剧", value: "喜剧" },
            { name: "爱情", value: "爱情" },
            { name: "悬疑", value: "悬疑" },
            { name: "动画", value: "动画" },
            { name: "武侠", value: "武侠" },
            { name: "古装", value: "古装" },
            { name: "家庭", value: "家庭" },
            { name: "犯罪", value: "犯罪" },
            { name: "科幻", value: "科幻" },
            { name: "恐怖", value: "恐怖" },
            { name: "历史", value: "历史" },
            { name: "战争", value: "战争" },
            { name: "动作", value: "动作" },
            { name: "冒险", value: "冒险" },
            { name: "传记", value: "传记" },
            { name: "剧情", value: "剧情" },
            { name: "奇幻", value: "奇幻" },
            { name: "惊悚", value: "惊悚" },
            { name: "灾难", value: "灾难" },
            { name: "歌舞", value: "歌舞" },
            { name: "音乐", value: "音乐" },
          ],
        },
        // 地区筛选器
        {
          key: "region",
          name: "地区",
          init: "", // 默认值：全部（空字符串）
          value: [
            { name: "全部", value: "" },
            { name: "华语", value: "华语" },
            { name: "欧美", value: "欧美" },
            { name: "国外", value: "国外" },
            { name: "韩国", value: "韩国" },
            { name: "日本", value: "日本" },
            { name: "中国大陆", value: "中国大陆" },
            { name: "中国香港", value: "中国香港" },
            { name: "美国", value: "美国" },
            { name: "英国", value: "英国" },
            { name: "泰国", value: "泰国" },
            { name: "中国台湾", value: "中国台湾" },
            { name: "意大利", value: "意大利" },
            { name: "法国", value: "法国" },
            { name: "德国", value: "德国" },
            { name: "西班牙", value: "西班牙" },
            { name: "俄罗斯", value: "俄罗斯" },
            { name: "瑞典", value: "瑞典" },
            { name: "巴西", value: "巴西" },
            { name: "丹麦", value: "丹麦" },
            { name: "印度", value: "印度" },
            { name: "加拿大", value: "加拿大" },
            { name: "爱尔兰", value: "爱尔兰" },
            { name: "澳大利亚", value: "澳大利亚" },
          ],
        },
        // 年代筛选器
        {
          key: "year",
          name: "年代",
          init: "", // 默认值：全部（空字符串）
          value: [
            { name: "全部", value: "" },
            { name: "2026", value: "2026" },
            { name: "2025", value: "2025" },
            { name: "2024", value: "2024" },
            { name: "2023", value: "2023" },
            { name: "2022", value: "2022" },
            { name: "2021", value: "2021" },
            { name: "2020", value: "2020" },
            { name: "2019", value: "2019" },
            { name: "2020年代", value: "2020年代" },
            { name: "2010年代", value: "2010年代" },
            { name: "2000年代", value: "2000年代" },
            { name: "90年代", value: "90年代" },
            { name: "80年代", value: "80年代" },
            { name: "70年代", value: "70年代" },
            { name: "60年代", value: "60年代" },
            { name: "更早", value: "更早" },
          ],
        },
        // 平台筛选器
        {
          key: "platform",
          name: "平台",
          init: "", // 默认值：全部（空字符串）
          value: [
            { name: "全部", value: "" },
            { name: "腾讯视频", value: "腾讯视频" },
            { name: "爱奇艺", value: "爱奇艺" },
            { name: "优酷", value: "优酷" },
            { name: "湖南卫视", value: "湖南卫视" },
            { name: "Netflix", value: "Netflix" },
            { name: "HBO", value: "HBO" },
            { name: "BBC", value: "BBC" },
            { name: "NHK", value: "NHK" },
            { name: "CBS", value: "CBS" },
            { name: "NBC", value: "NBC" },
            { name: "tvN", value: "tvN" },
          ],
        },
        // 排序筛选器
        {
          key: "sort",
          name: "排序",
          init: "U", // 默认值：热度
          value: [
            { name: "热度", value: "U" },
            { name: "评分", value: "S" },
            { name: "时间", value: "R" },
          ],
        },
      ],
      // 综艺筛选的筛选器
      show_filter: [
        // 类型筛选器（只有4个选项）
        {
          key: "genre",
          name: "类型",
          init: "", // 默认值：全部（空字符串）
          value: [
            { name: "全部", value: "" },
            { name: "真人秀", value: "真人秀" },
            { name: "脱口秀", value: "脱口秀" },
            { name: "音乐", value: "音乐" },
            { name: "歌舞", value: "歌舞" },
          ],
        },
        // 地区筛选器（和电视剧筛选一样）
        {
          key: "region",
          name: "地区",
          init: "", // 默认值：全部（空字符串）
          value: [
            { name: "全部", value: "" },
            { name: "华语", value: "华语" },
            { name: "欧美", value: "欧美" },
            { name: "国外", value: "国外" },
            { name: "韩国", value: "韩国" },
            { name: "日本", value: "日本" },
            { name: "中国大陆", value: "中国大陆" },
            { name: "中国香港", value: "中国香港" },
            { name: "美国", value: "美国" },
            { name: "英国", value: "英国" },
            { name: "泰国", value: "泰国" },
            { name: "中国台湾", value: "中国台湾" },
            { name: "意大利", value: "意大利" },
            { name: "法国", value: "法国" },
            { name: "德国", value: "德国" },
            { name: "西班牙", value: "西班牙" },
            { name: "俄罗斯", value: "俄罗斯" },
            { name: "瑞典", value: "瑞典" },
            { name: "巴西", value: "巴西" },
            { name: "丹麦", value: "丹麦" },
            { name: "印度", value: "印度" },
            { name: "加拿大", value: "加拿大" },
            { name: "爱尔兰", value: "爱尔兰" },
            { name: "澳大利亚", value: "澳大利亚" },
          ],
        },
        // 年代筛选器（和电视剧筛选一样）
        {
          key: "year",
          name: "年代",
          init: "", // 默认值：全部（空字符串）
          value: [
            { name: "全部", value: "" },
            { name: "2026", value: "2026" },
            { name: "2025", value: "2025" },
            { name: "2024", value: "2024" },
            { name: "2023", value: "2023" },
            { name: "2022", value: "2022" },
            { name: "2021", value: "2021" },
            { name: "2020", value: "2020" },
            { name: "2019", value: "2019" },
            { name: "2020年代", value: "2020年代" },
            { name: "2010年代", value: "2010年代" },
            { name: "2000年代", value: "2000年代" },
            { name: "90年代", value: "90年代" },
            { name: "80年代", value: "80年代" },
            { name: "70年代", value: "70年代" },
            { name: "60年代", value: "60年代" },
            { name: "更早", value: "更早" },
          ],
        },
        // 平台筛选器（和电视剧筛选一样）
        {
          key: "platform",
          name: "平台",
          init: "", // 默认值：全部（空字符串）
          value: [
            { name: "全部", value: "" },
            { name: "腾讯视频", value: "腾讯视频" },
            { name: "爱奇艺", value: "爱奇艺" },
            { name: "优酷", value: "优酷" },
            { name: "湖南卫视", value: "湖南卫视" },
            { name: "Netflix", value: "Netflix" },
            { name: "HBO", value: "HBO" },
            { name: "BBC", value: "BBC" },
            { name: "NHK", value: "NHK" },
            { name: "CBS", value: "CBS" },
            { name: "NBC", value: "NBC" },
            { name: "tvN", value: "tvN" },
          ],
        },
        // 排序筛选器（和电视剧筛选一样）
        {
          key: "sort",
          name: "排序",
          init: "U", // 默认值：热度
          value: [
            { name: "热度", value: "U" },
            { name: "评分", value: "S" },
            { name: "时间", value: "R" },
          ],
        },
      ],
    };

    // 获取首页推荐列表（选剧集的综合数据）
    let list = [];
    try {
      const tvListUrl = "https://m.douban.com/rexxar/api/v2/subject/recent_hot/tv?start=0&limit=20&category=tv&type=tv";
      const tvListResponse = await OmniBox.request(tvListUrl, {
        method: "GET",
        headers: {
          "Accept": "*/*",
          "Accept-Encoding": "gzip, deflate, br",
          "Connection": "keep-alive",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "referer": "https://movie.douban.com/tv/",
        },
      });

      if (tvListResponse.statusCode === 200 && tvListResponse.body) {
        let tvListBodyStr = typeof tvListResponse.body === "string" ? tvListResponse.body : String(tvListResponse.body);
        const tvListData = JSON.parse(tvListBodyStr);

        if (tvListData.items && Array.isArray(tvListData.items)) {
          const baseURL = context.baseURL || "";

          list = tvListData.items.map((item) => {
            // 从 card_subtitle 提取年份信息
            let vod_year = "";
            const cardSubtitle = item.card_subtitle || "";
            const yearMatch = cardSubtitle.match(/^(\d{4})/);
            if (yearMatch) {
              vod_year = yearMatch[1];
            }

            // 构建备注信息
            let vod_remarks = "";
            if (item.episodes_info && item.episodes_info.trim()) {
              vod_remarks = item.episodes_info.trim();
            } else if (item.is_new) {
              vod_remarks = "新剧";
            }


            // 处理图片URL
            let vod_pic = item.pic?.large || item.pic?.normal || "";
            if (vod_pic) {
              const urlWithHeaders = `${vod_pic}@Referer=https://m.douban.com`;
              if (baseURL) {
                const encodedUrl = encodeURIComponent(urlWithHeaders);
                vod_pic = `${baseURL}/api/proxy/image?url=${encodedUrl}`;
              } else {
                vod_pic = urlWithHeaders;
              }
            }

            // 构建副标题（从card_subtitle提取，去除年份部分）
            let vod_subtitle = "";
            if (cardSubtitle) {
              const parts = cardSubtitle.split(" / ");
              if (parts.length > 1) {
                vod_subtitle = parts.slice(1).join(" / ");
              } else {
                vod_subtitle = cardSubtitle;
              }
            }

            return {
              vod_id: item.id || `douban_${item.uri}`,
              link: buildDoubanSubjectLink(item.id || `douban_${item.uri}`),
              vod_name: item.title || "",
              vod_pic: vod_pic,
              type_id: "tv",
              search: true,
              type_name: "选剧集",
              vod_remarks: vod_remarks,
              vod_year: vod_year,
              vod_douban_score: item.rating?.value ? item.rating.value.toString() : "",
              vod_subtitle: vod_subtitle,
            };
          });
        }
      }
    } catch (listError) {
      // 列表获取失败不影响首页数据返回
      await OmniBox.log("warn", `获取首页列表数据失败: ${listError.message}`);
    }

    return {
      class: classes,
      list: list, // 返回选剧集的综合数据
      filters: filters,
      banner: banner, // 返回Banner数据
    };
  } catch (error) {
    return {
      class: [],
      list: [],
      filters: {},
    };
  }
}

/**
 * 获取分类数据
 * @param {Object} params - 参数对象
 *   - categoryId: 分类ID（必填，movie、tv 或 show）
 *   - page: 页码（必填，默认1）
 *   - filters: 筛选条件（可选，JSON对象）
 *     格式：{ "category": "热门", "type": "全部" } 或 { "type": "tv_domestic" }
 * @returns {Object} 返回视频列表
 *   - list: 视频列表
 *   - page: 当前页码
 *   - pagecount: 总页数
 *   - total: 总记录数
 */
async function category(params, context) {
  try {
    const categoryId = params.categoryId || "movie";
    const page = params.page || 1;
    const filters = params.filters || {};
    const limit = 20; // 每页数量
    const start = (page - 1) * limit;
    let url = "";
    let referer = "";

    // 根据分类ID构建不同的请求URL和referer
    if (categoryId === "movie") {
      // 电影分类
      const category = filters.category || "热门";
      const type = filters.type || "全部";
      url = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/movie?start=${start}&limit=${limit}&category=${encodeURIComponent(category)}&type=${encodeURIComponent(type)}`;
      referer = "https://movie.douban.com/explore";
    } else if (categoryId === "tv" || categoryId === "show") {
      // 剧集和综艺使用同一个接口，但category参数不同
      const category = categoryId; // tv 或 show
      const type = filters.type || (categoryId === "tv" ? "tv_domestic" : "show");
      url = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/tv?start=${start}&limit=${limit}&category=${encodeURIComponent(category)}&type=${encodeURIComponent(type)}`;
      referer = categoryId === "tv" ? "https://movie.douban.com/tv/" : "https://movie.douban.com/tv/";
    } else if (categoryId === "movie_filter") {
      // 电影筛选分类
      const genre = filters.genre || ""; // 类型，全部为空字符串
      const region = filters.region || ""; // 地区，全部为空字符串
      const year = filters.year || ""; // 年代，全部为空字符串
      const sort = filters.sort || "U"; // 排序，默认热度

      // 构建 selected_categories JSON
      const selectedCategories = {};
      if (genre) selectedCategories["类型"] = genre;
      if (region) selectedCategories["地区"] = region;
      const selectedCategoriesStr = JSON.stringify(selectedCategories);

      // 构建 tags 参数（逗号分隔：类型,地区,年份）
      const tagsArray = [];
      if (genre) tagsArray.push(genre);
      if (region) tagsArray.push(region);
      if (year) tagsArray.push(year);
      const tags = tagsArray.join(",");

      // 构建完整URL
      url = `https://m.douban.com/rexxar/api/v2/movie/recommend?refresh=0&start=${start}&count=${limit}&selected_categories=${encodeURIComponent(selectedCategoriesStr)}&uncollect=false&score_range=0,10&tags=${encodeURIComponent(tags)}&sort=${sort}`;
      referer = "https://movie.douban.com/explore";
    } else if (categoryId === "tv_filter") {
      // 电视剧筛选分类
      const genre = filters.genre || ""; // 类型，全部为空字符串
      const region = filters.region || ""; // 地区，全部为空字符串
      const year = filters.year || ""; // 年代，全部为空字符串
      const platform = filters.platform || ""; // 平台，全部为空字符串
      const sort = filters.sort || "U"; // 排序，默认热度

      // 构建 selected_categories JSON（形式固定为"电视剧"）
      const selectedCategories = { "形式": "电视剧" };
      if (genre) selectedCategories["类型"] = genre;
      if (region) selectedCategories["地区"] = region;
      const selectedCategoriesStr = JSON.stringify(selectedCategories);

      // 构建 tags 参数（逗号分隔：类型,地区,年份,平台）
      const tagsArray = [];
      if (genre) tagsArray.push(genre);
      if (region) tagsArray.push(region);
      if (year) tagsArray.push(year);
      if (platform) tagsArray.push(platform);
      const tags = tagsArray.join(",");

      // 构建完整URL
      url = `https://m.douban.com/rexxar/api/v2/tv/recommend?refresh=0&start=${start}&count=${limit}&selected_categories=${encodeURIComponent(selectedCategoriesStr)}&uncollect=false&score_range=0,10&tags=${encodeURIComponent(tags)}&sort=${sort}`;
      referer = "https://movie.douban.com/tv/";
    } else if (categoryId === "show_filter") {
      // 综艺筛选分类（使用和电视剧筛选相同的接口）
      const genre = filters.genre || ""; // 类型，全部为空字符串
      const region = filters.region || ""; // 地区，全部为空字符串
      const year = filters.year || ""; // 年代，全部为空字符串
      const platform = filters.platform || ""; // 平台，全部为空字符串
      const sort = filters.sort || "U"; // 排序，默认热度

      // 构建 selected_categories JSON（形式固定为"综艺"）
      const selectedCategories = { "形式": "综艺" };
      if (genre) selectedCategories["类型"] = genre;
      if (region) selectedCategories["地区"] = region;
      const selectedCategoriesStr = JSON.stringify(selectedCategories);

      // 构建 tags 参数（逗号分隔：类型,地区,年份,平台）
      const tagsArray = [];
      if (genre) tagsArray.push(genre);
      if (region) tagsArray.push(region);
      if (year) tagsArray.push(year);
      if (platform) tagsArray.push(platform);
      const tags = tagsArray.join(",");

      // 构建完整URL（使用和电视剧筛选相同的接口）
      url = `https://m.douban.com/rexxar/api/v2/tv/recommend?refresh=0&start=${start}&count=${limit}&selected_categories=${encodeURIComponent(selectedCategoriesStr)}&uncollect=false&score_range=0,10&tags=${encodeURIComponent(tags)}&sort=${sort}`;
      referer = "https://movie.douban.com/tv/";
    } else {
      throw new Error(`未知的分类ID: ${categoryId}`);
    }
    // 发送请求
    // SDK 现在支持自动解压 gzip/br 压缩数据
    const response = await OmniBox.request(url, {
      method: "GET",
      headers: {
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "referer": referer,
      },
    });

    // 检查响应状态
    if (response.statusCode !== 200) {
      throw new Error(`HTTP请求失败: ${response.statusCode}`);
    }

    // 检查响应体
    if (!response.body) {
      throw new Error("响应体为空");
    }

    // SDK 已自动处理 gzip/br/deflate 解压，response.body 应该是字符串
    let bodyStr = typeof response.body === "string" ? response.body : String(response.body);

    // 尝试解析响应数据
    let data;
    try {
      data = JSON.parse(bodyStr);
    } catch (parseError) {
      throw new Error(`JSON解析失败: ${parseError.message}`);
    }

    // 检查数据格式（movie_filter和tv_filter返回的字段名是items，其他是items）
    if (!data.items || !Array.isArray(data.items)) {
      throw new Error("API返回数据格式错误");
    }

    // 根据分类ID确定分类名称
    const categoryNames = {
      movie: "选电影",
      tv: "选剧集",
      show: "选综艺",
      movie_filter: "电影筛选",
      tv_filter: "电视剧筛选",
      show_filter: "综艺筛选",
    };
    const typeName = categoryNames[categoryId] || "未知分类";

    // 转换数据格式
    const list = data.items.map((item) => {
      // 从 card_subtitle 提取年份信息
      // 格式示例: "2025 / 中国香港 中国大陆 / 剧情 犯罪 / 麦浚龙 / 金城武 刘青云"
      // 或: "2026 / 中国大陆 / 剧情 / 孙皓 / 赵丽颖 黄晓明"
      let vod_year = "";
      const cardSubtitle = item.card_subtitle || "";
      const yearMatch = cardSubtitle.match(/^(\d{4})/);
      if (yearMatch) {
        vod_year = yearMatch[1];
      }

      // 构建备注信息
      let vod_remarks = "";

      // 对于剧集和综艺，优先显示集数信息
      if (item.episodes_info && item.episodes_info.trim()) {
        vod_remarks = item.episodes_info.trim();
      } else if (item.is_new) {
        vod_remarks = categoryId === "movie" ? "新片" : "新剧";
      }


      // 处理图片URL，使用通用图片代理接口
      // 通过环境变量获取baseURL（脚本执行时会自动注入）
      const baseURL = context.baseURL || "";
      let vod_pic = item.pic?.large || item.pic?.normal || "";
      if (vod_pic) {
        // 构建带headers的URL格式: url@Referer=value
        const urlWithHeaders = `${vod_pic}@Referer=https://m.douban.com`;

        // 如果有baseURL，拼接完整的代理接口地址
        if (baseURL) {
          // 编码URL参数
          const encodedUrl = encodeURIComponent(urlWithHeaders);
          vod_pic = `${baseURL}/api/proxy/image?url=${encodedUrl}`;
        } else {
          // 如果没有baseURL，返回带headers的原始格式（兼容旧版本）
          vod_pic = urlWithHeaders;
        }
      }

      // 构建副标题（从card_subtitle提取，去除年份部分）
      let vod_subtitle = "";
      if (cardSubtitle) {
        // 格式: "2025 / 中国香港 中国大陆 / 剧情 犯罪 / 麦浚龙 / 金城武 刘青云"
        // 副标题：去除年份，保留其他信息
        const parts = cardSubtitle.split(" / ");
        if (parts.length > 1) {
          vod_subtitle = parts.slice(1).join(" / ");
        } else {
          // 如果没有年份，直接使用整个card_subtitle
          vod_subtitle = cardSubtitle;
        }
      }

      return {
        vod_id: item.id || `douban_${item.uri}`,
        link: buildDoubanSubjectLink(item.id || `douban_${item.uri}`),
        vod_name: item.title || "",
        search: true,
        vod_pic: vod_pic,
        type_id: categoryId,
        type_name: typeName,
        vod_remarks: vod_remarks,
        vod_year: vod_year,
        vod_douban_score: item.rating?.value ? item.rating.value.toString() : "",
        vod_subtitle: vod_subtitle, // 添加副标题
      };
    });

    // 计算总页数（movie_filter和tv_filter返回的字段名是total，其他可能不同）
    const total = data.total || data.count || list.length;
    const pagecount = Math.ceil(total / limit);
    return {
      page: page,
      pagecount: pagecount,
      total: total,
      list: list,
    };
  } catch (error) {
    return {
      page: params.page || 1,
      pagecount: 0,
      total: 0,
      list: [],
    };
  }
}
